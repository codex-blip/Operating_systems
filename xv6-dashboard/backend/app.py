"""Flask backend for the xv6 dashboard (API base: http://127.0.0.1:5000/api).

The JSON/SSE contract is shared with the React frontend; do not rename fields.

Parser interface (implemented in parsers.py):
    p = parsers.get_parser(task_id)      # task ids + "command"
    p.feed(text) -> [Subtest, ...]       # text uses "\n"; returns changed subtests
    p.finish(completed) -> (status, [Subtest, ...])   # status "pass" | "fail"
"""
import atexit
import json
import os
import queue
import signal
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime

from flask import Flask, Response, jsonify, request
from flask_cors import CORS

import config
import history
import parsers
import qemu_runner

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

HISTORY = history.History(config.HISTORY_FILE, config.HISTORY_MAX)
TERMINAL_EVENTS = ("finished", "all_finished", "error")


@app.after_request
def add_private_network_header(resp):
    # Chrome's Private Network Access preflight
    if request.method == "OPTIONS":
        resp.headers["Access-Control-Allow-Private-Network"] = "true"
    return resp


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def new_run_id():
    return datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]


def make_result(task, status, duration, subtests, extra=None):
    res = {
        "task": task,
        "status": status,
        "duration": round(float(duration), 1),
        "subtests": list(subtests),
        "finished_at": now_iso(),
    }
    if extra:
        if extra.get("metrics"):
            res["metrics"] = dict(extra["metrics"])
        if extra.get("evidence"):
            res["evidence"] = list(extra["evidence"])
        if extra.get("mode"):
            res["mode"] = extra["mode"]
    return res


def error_event(code, message):
    return {"type": "error", "code": code, "message": message}


def api_error(code, message, http_status):
    return jsonify({"error": code, "message": message}), http_status


def build_args():
    return ["-j%d" % config.MAKE_JOBS] + list(config.BUILD_TARGETS)


# ----------------------------------------------------------------------------
# run state
# ----------------------------------------------------------------------------
class Run:
    def __init__(self, run_id):
        self.run_id = run_id
        self.events = queue.Queue()
        self.cancel = threading.Event()
        self.terminal_sent = False

    def emit(self, event):
        if self.terminal_sent:
            return
        self.events.put(event)
        if event.get("type") in TERMINAL_EVENTS:
            self.terminal_sent = True


class RunManager:
    """Exactly one run at a time. _run_lock is held for the run's whole life."""

    def __init__(self, last_results):
        self._run_lock = threading.Lock()
        self._meta = threading.Lock()
        self._run = None
        self._state = "idle"
        self._task = None
        self._qemu = False
        self._last_results = {k: v for k, v in last_results.items() if k in config.TASKS}

    def try_begin(self, task):
        if not self._run_lock.acquire(blocking=False):
            return None
        run = Run(new_run_id())
        with self._meta:
            self._run, self._task, self._state, self._qemu = run, task, "running", False
        return run

    def end(self, run):
        with self._meta:
            if self._run is run:
                self._run, self._task, self._state, self._qemu = None, None, "idle", False
        self._run_lock.release()

    def set_state(self, state):
        with self._meta:
            if self._run is not None:
                self._state = state

    def set_task(self, task):
        with self._meta:
            if self._run is not None:
                self._task = task

    def set_qemu(self, running):
        with self._meta:
            self._qemu = running

    def store_result(self, task, result):
        with self._meta:
            self._last_results[task] = result

    def cancel(self):
        with self._meta:
            run = self._run
        if run is None:
            return False
        run.cancel.set()
        return True

    def busy_payload(self):
        with self._meta:
            return {"error": "busy", "current_task": self._task}

    def status(self):
        with self._meta:
            active = self._run is not None
            return {
                "state": self._state if active else "idle",
                "current_task": self._task if active else None,
                "run_id": self._run.run_id if active else None,
                "last_results": dict(self._last_results),
            }

    def qemu_state(self):
        with self._meta:
            return "running" if self._qemu else "idle"


MANAGER = RunManager(HISTORY.latest_results())


def record(run_id, task, started_at, result):
    HISTORY.add(run_id, task, started_at, result)
    MANAGER.store_result(task, result)


def notice(run, message):
    """Backend message shown in the terminal (yellow)."""
    run.emit({"type": "output", "data": "\r\n\x1b[33m[dashboard] %s\x1b[0m\r\n" % message})


# ----------------------------------------------------------------------------
# SSE plumbing
# ----------------------------------------------------------------------------
def sse_response(run):
    def generate():
        try:
            while True:
                try:
                    event = run.events.get(timeout=config.KEEPALIVE_SECONDS)
                except queue.Empty:
                    yield ": ping\n\n"
                    continue
                yield "data: " + json.dumps(event) + "\n\n"
                if event.get("type") in TERMINAL_EVENTS:
                    return
        finally:
            # Client went away before the run finished: stop the run so that
            # no QEMU keeps running with nobody watching.
            if not run.terminal_sent:
                run.cancel.set()

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def start_stream(first_task, worker):
    """Start `worker(run)` in a thread; it must return the terminal event."""
    run = MANAGER.try_begin(first_task)
    if run is None:
        return jsonify(MANAGER.busy_payload()), 409

    def target():
        final = None
        try:
            final = worker(run)
        except Exception as exc:
            app.logger.exception("run %s crashed", run.run_id)
            final = error_event("internal", "%s: %s" % (type(exc).__name__, exc))
        finally:
            # Release the run lock BEFORE the client sees the terminal event,
            # so an immediate follow-up request never gets a spurious 409.
            MANAGER.end(run)
            run.emit(final or error_event("internal", "run ended without a result"))

    threading.Thread(target=target, name="run-" + run.run_id, daemon=True).start()
    return sse_response(run)


# ----------------------------------------------------------------------------
# building and running
# ----------------------------------------------------------------------------
def build(run, arg_lists):
    MANAGER.set_state("building")
    try:
        for args in arg_lists:
            run.emit({"type": "build", "line": "$ make " + " ".join(args)})
            ok, reason = qemu_runner.run_make(
                args,
                lambda line: run.emit({"type": "build", "line": line}),
                run.cancel,
                config.BUILD_TIMEOUT,
            )
            if not ok:
                return False, reason
        return True, "ok"
    finally:
        MANAGER.set_state("running")


def build_error(reason):
    if reason == "timeout":
        return error_event("timeout", "make did not finish within %ds" % config.BUILD_TIMEOUT)
    return error_event("build_failed", "%s (see the build output above)" % reason)


BOOT_FAILURES = {
    "timeout": ("timeout", "xv6 did not reach the shell prompt within %ds" % config.BOOT_TIMEOUT),
    "eof": ("qemu_failed", "QEMU exited before the shell prompt appeared (see output above)"),
    "panic": ("qemu_failed", "kernel panic while booting (see output above)"),
}


def run_in_qemu(run, command, timeout, parser):
    """Boot a fresh xv6, run one shell command, stop QEMU.

    Returns {"status","subtests","duration","error"}; error is None or
    (code, message). QEMU is always stopped before this returns.
    """
    def on_terminal(text):
        run.emit({"type": "output", "data": text})

    def on_text(text):
        for st in parser.feed(text):
            run.emit({"type": "subtest", "name": st["name"], "status": st["status"],
                      "detail": st.get("detail", "")})

    MANAGER.set_state("running")
    session = qemu_runner.QemuSession(on_terminal)
    outcome = None
    duration = 0.0
    try:
        try:
            session.start()
        except Exception as exc:
            msg = "could not start '%s' in %s: %s" % (" ".join(config.QEMU_COMMAND), config.XV6_PATH, exc)
            notice(run, msg)
            return {"status": "error", "subtests": [], "duration": 0.0, "error": ("qemu_failed", msg)}
        MANAGER.set_qemu(True)

        boot = session.wait_for_prompt(run.cancel, config.BOOT_TIMEOUT)
        if boot == "cancelled":
            notice(run, "cancelled while booting; stopping QEMU")
            return {"status": "cancelled", "subtests": [], "duration": 0.0, "error": None}
        if boot != "prompt":
            code, msg = BOOT_FAILURES[boot]
            notice(run, msg)
            status = "timeout" if boot == "timeout" else "error"
            return {"status": status, "subtests": [], "duration": 0.0, "error": (code, msg)}

        t0 = time.monotonic()
        outcome = session.run_command(command, run.cancel, timeout, on_text)
        duration = time.monotonic() - t0
        if outcome == "timeout":
            notice(run, "timed out after %ds; stopping QEMU" % timeout)
        elif outcome == "cancelled":
            notice(run, "cancelled; stopping QEMU")
        elif outcome == "panic":
            notice(run, "kernel panic detected; stopping QEMU")
        elif outcome == "eof":
            notice(run, "QEMU exited while the command was running")
    finally:
        session.close()
        MANAGER.set_qemu(False)

    parser_status, subtests = parser.finish(outcome == "prompt")
    extra = parser.summary() if hasattr(parser, "summary") else {}
    status = {
        "prompt": parser_status,
        "timeout": "timeout",
        "cancelled": "cancelled",
        "panic": "fail",
        "eof": "error",
    }[outcome]
    error = ("qemu_failed", "QEMU exited while the command was running") if outcome == "eof" else None
    return {"status": status, "subtests": subtests, "duration": duration, "error": error, "extra": extra}


def single_task_worker(task_id):
    task = config.TASKS[task_id]

    def worker(run):
        started_at = now_iso()
        run.emit({"type": "started", "run_id": run.run_id, "task": task_id,
                  "command": task["command"], "ts": started_at})
        if config.BUILD_BEFORE_RUN:
            ok, reason = build(run, [build_args()])
            if not ok:
                if reason == "cancelled":
                    result = make_result(task_id, "cancelled", 0.0, [])
                    record(run.run_id, task_id, started_at, result)
                    return {"type": "finished", "run_id": run.run_id, "task": task_id, "result": result}
                record(run.run_id, task_id, started_at, make_result(task_id, "error", 0.0, []))
                return build_error(reason)

        out = run_in_qemu(run, task["command"], task["timeout"], parsers.get_parser(task_id))
        extra = dict(out.get("extra") or {}, mode="suite")
        result = make_result(task_id, out["status"], out["duration"], out["subtests"], extra)
        record(run.run_id, task_id, started_at, result)
        if out["error"]:
            return error_event(*out["error"])
        return {"type": "finished", "run_id": run.run_id, "task": task_id, "result": result}

    return worker


def verify_task_worker(task_id):
    cmd = "verify %s" % task_id

    def worker(run):
        started_at = now_iso()
        run.emit({"type": "started", "run_id": run.run_id, "task": task_id,
                  "command": cmd, "ts": started_at})
        if config.BUILD_BEFORE_RUN:
            ok, reason = build(run, [build_args()])
            if not ok:
                if reason == "cancelled":
                    result = make_result(task_id, "cancelled", 0.0, [], {"mode": "verify"})
                    record(run.run_id, task_id, started_at, result)
                    return {"type": "finished", "run_id": run.run_id, "task": task_id, "result": result}
                record(run.run_id, task_id, started_at, make_result(task_id, "error", 0.0, [], {"mode": "verify"}))
                return build_error(reason)

        out = run_in_qemu(run, cmd, 90, parsers.get_verify_parser(task_id))
        extra = dict(out.get("extra") or {}, mode="verify")
        result = make_result(task_id, out["status"], out["duration"], out["subtests"], extra)
        record(run.run_id, task_id, started_at, result)
        if out["error"]:
            return error_event(*out["error"])
        return {"type": "finished", "run_id": run.run_id, "task": task_id, "result": result}

    return worker


def verify_all_worker(run):
    run.emit({"type": "started", "run_id": run.run_id, "task": "all",
              "command": "verify task1..task3", "ts": now_iso()})
    if config.BUILD_BEFORE_RUN:
        ok, reason = build(run, [build_args()])
        if not ok:
            if reason == "cancelled":
                return {"type": "all_finished", "results": {}}
            return build_error(reason)

    results = {}
    session = qemu_runner.QemuSession(lambda text: run.emit({"type": "output", "data": text}))
    try:
        try:
            session.start()
        except Exception as exc:
            msg = "could not start QEMU: %s" % exc
            notice(run, msg)
            return error_event("qemu_failed", msg)
        MANAGER.set_qemu(True)
        boot = session.wait_for_prompt(run.cancel, config.BOOT_TIMEOUT)
        if boot == "cancelled":
            return {"type": "all_finished", "results": {}}
        if boot != "prompt":
            code, msg = BOOT_FAILURES[boot]
            notice(run, msg)
            return error_event(code, msg)

        for task_id in config.RUN_ALL_ORDER:
            if run.cancel.is_set():
                break
            MANAGER.set_task(task_id)
            run.emit({"type": "task_started", "task": task_id})
            started_at = now_iso()
            parser = parsers.get_verify_parser(task_id)

            def on_text(text, p=parser):
                for st in p.feed(text):
                    run.emit({"type": "subtest", "name": st["name"], "status": st["status"],
                              "detail": st.get("detail", "")})

            t0 = time.monotonic()
            outcome = session.run_command("verify %s" % task_id, run.cancel, 90, on_text)
            duration = time.monotonic() - t0
            p_status, subtests = parser.finish(outcome == "prompt")
            status = {
                "prompt": p_status, "timeout": "timeout", "cancelled": "cancelled",
                "panic": "fail", "eof": "error",
            }[outcome]
            extra = dict(parser.summary(), mode="verify")
            result = make_result(task_id, status, duration, subtests, extra)
            record("%s-%s" % (run.run_id, task_id), task_id, started_at, result)
            results[task_id] = result
            run.emit({"type": "task_finished", "task": task_id, "status": result["status"],
                      "duration": result["duration"], "result": result})
            if outcome != "prompt":
                break
    finally:
        session.close()
        MANAGER.set_qemu(False)
    return {"type": "all_finished", "results": results}


def run_all_worker(run):
    run.emit({"type": "started", "run_id": run.run_id, "task": "all",
              "command": " ; ".join(config.TASKS[t]["command"] for t in config.RUN_ALL_ORDER),
              "ts": now_iso()})
    if config.BUILD_BEFORE_RUN:
        ok, reason = build(run, [build_args()])
        if not ok:
            if reason == "cancelled":
                return {"type": "all_finished", "results": {}}
            return build_error(reason)

    results = {}
    for task_id in config.RUN_ALL_ORDER:
        if run.cancel.is_set():
            break
        task = config.TASKS[task_id]
        MANAGER.set_task(task_id)
        run.emit({"type": "task_started", "task": task_id})
        started_at = now_iso()
        out = run_in_qemu(run, task["command"], task["timeout"], parsers.get_parser(task_id))
        extra = dict(out.get("extra") or {}, mode="suite")
        result = make_result(task_id, out["status"], out["duration"], out["subtests"], extra)
        record("%s-%s" % (run.run_id, task_id), task_id, started_at, result)
        results[task_id] = result
        run.emit({"type": "task_finished", "task": task_id, "status": result["status"],
                  "duration": result["duration"], "result": result})
        if result["status"] == "cancelled":
            break
    return {"type": "all_finished", "results": results}


def command_worker(command):
    def worker(run):
        run.emit({"type": "started", "run_id": run.run_id, "task": "command",
                  "command": command, "ts": now_iso()})
        if config.BUILD_BEFORE_RUN:
            ok, reason = build(run, [build_args()])
            if not ok:
                if reason == "cancelled":
                    result = make_result("command", "cancelled", 0.0, [])
                    return {"type": "finished", "run_id": run.run_id, "task": "command", "result": result}
                return build_error(reason)
        out = run_in_qemu(run, command, config.COMMAND_TIMEOUT, parsers.get_parser("command"))
        result = make_result("command", out["status"], out["duration"], out["subtests"])
        if out["error"]:
            return error_event(*out["error"])
        return {"type": "finished", "run_id": run.run_id, "task": "command", "result": result}

    return worker


def rebuild_worker(clean):
    arg_lists = ([["clean"]] if clean else []) + [build_args()]

    def worker(run):
        run.emit({"type": "started", "run_id": run.run_id, "task": "rebuild",
                  "command": " && ".join("make " + " ".join(a) for a in arg_lists), "ts": now_iso()})
        t0 = time.monotonic()
        ok, reason = build(run, arg_lists)
        duration = time.monotonic() - t0
        if not ok and reason != "cancelled":
            return build_error(reason)
        result = make_result("rebuild", "pass" if ok else "cancelled", duration, [])
        return {"type": "finished", "run_id": run.run_id, "task": "rebuild", "result": result}

    return worker


# ----------------------------------------------------------------------------
# git (for /diff)
# ----------------------------------------------------------------------------
class GitError(Exception):
    pass


def git(*args):
    try:
        proc = subprocess.run(["git", "--no-pager"] + list(args), cwd=config.XV6_PATH,
                              capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=30)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GitError("git %s: %s" % (" ".join(args), exc))
    if proc.returncode != 0:
        raise GitError("git %s failed: %s" % (" ".join(args), proc.stderr.strip()))
    return proc.stdout


def task_commits(prefix):
    out = git("log", "--reverse", "--no-merges", "--format=%H%x1f%h%x1f%s",
              "%s..%s" % (config.GIT_BASE_COMMIT, config.GIT_BRANCH))
    commits = []
    for line in out.splitlines():
        parts = line.split("\x1f")
        if len(parts) == 3 and parts[2].startswith(prefix):
            commits.append({"full": parts[0], "hash": parts[1], "subject": parts[2]})
    return commits


# ----------------------------------------------------------------------------
# routes
# ----------------------------------------------------------------------------
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "qemu": MANAGER.qemu_state(), "xv6_path": config.XV6_PATH})


@app.route("/api/tasks", methods=["GET"])
def tasks():
    return jsonify([
        {"id": tid, "name": t["name"], "description": t["description"],
         "command": t["command"], "est_seconds": t["est_seconds"]}
        for tid, t in config.TASKS.items()
    ])


@app.route("/api/status", methods=["GET"])
def status():
    return jsonify(MANAGER.status())


@app.route("/api/history", methods=["GET"])
def get_history():
    return jsonify(HISTORY.public_items())


@app.route("/api/diff/<task>", methods=["GET"])
def diff(task):
    prefix = config.DIFF_PREFIXES.get(task)
    if prefix is None:
        return api_error("bad_request", "no diff for '%s' (use task1, task2a, task2b, task3)" % task, 404)
    try:
        commits = task_commits(prefix)
        if commits:
            text = "\n".join(git("show", "--no-color", "--no-ext-diff", c["full"]) for c in commits)
        else:
            text = git("diff", "--no-color", "--no-ext-diff", config.GIT_BASE_COMMIT)
    except GitError as exc:
        return api_error("internal", str(exc), 500)
    return jsonify({"task": task,
                    "commits": [{"hash": c["hash"], "subject": c["subject"]} for c in commits],
                    "diff": text})


@app.route("/api/run/<task>", methods=["POST"])
def run_task(task):
    if task not in config.TASKS:
        return api_error("bad_request", "unknown task '%s'" % task, 404)
    return start_stream(task, single_task_worker(task))


@app.route("/api/run-all", methods=["POST"])
def run_all():
    return start_stream(config.RUN_ALL_ORDER[0], run_all_worker)


@app.route("/api/verify/<task>", methods=["POST"])
def verify_task(task):
    if task not in config.RUN_ALL_ORDER:
        return api_error("bad_request", "unknown verify task '%s' (use task1, task2a, task2b, task3)" % task, 404)
    return start_stream(task, verify_task_worker(task))


@app.route("/api/verify-all", methods=["POST"])
def verify_all():
    return start_stream(config.RUN_ALL_ORDER[0], verify_all_worker)


@app.route("/api/command", methods=["POST"])
def command():
    body = request.get_json(silent=True, force=True) or {}
    cmd = body.get("command") if isinstance(body, dict) else None
    if not isinstance(cmd, str):
        return api_error("bad_request", 'body must be {"command": "<text>"}', 400)
    cmd = cmd.strip(" ")
    if not cmd:
        return api_error("bad_request", "command is empty", 400)
    if any(not (32 <= ord(ch) <= 126) for ch in cmd):
        return api_error("bad_request", "control characters, newlines and non-ASCII text are not allowed", 400)
    if len(cmd) > config.MAX_COMMAND_LENGTH:
        return api_error("bad_request", "command longer than %d characters" % config.MAX_COMMAND_LENGTH, 400)
    return start_stream("command", command_worker(cmd))


@app.route("/api/rebuild", methods=["POST"])
def rebuild():
    body = request.get_json(silent=True, force=True) or {}
    clean = body.get("clean", False) if isinstance(body, dict) else False
    if not isinstance(clean, bool):
        return api_error("bad_request", '"clean" must be true or false', 400)
    return start_stream("rebuild", rebuild_worker(clean))


@app.route("/api/cancel", methods=["POST"])
def cancel():
    return jsonify({"ok": True, "cancelled": MANAGER.cancel()})


@app.errorhandler(404)
def not_found(_exc):
    return api_error("bad_request", "no such endpoint: %s %s" % (request.method, request.path), 404)


@app.errorhandler(405)
def bad_method(_exc):
    return api_error("bad_request", "method %s not allowed on %s" % (request.method, request.path), 405)


@app.errorhandler(500)
def internal_error(exc):
    return api_error("internal", str(getattr(exc, "original_exception", exc)), 500)


# ----------------------------------------------------------------------------
# startup / shutdown
# ----------------------------------------------------------------------------
def _handle_signal(signum, _frame):
    qemu_runner.kill_all()
    sys.exit(128 + signum)


def main():
    if not os.path.isfile(os.path.join(config.XV6_PATH, "Makefile")):
        print("[backend] WARNING: no Makefile in XV6_PATH=%s" % config.XV6_PATH, file=sys.stderr)
    stale = qemu_runner.reap_stale_processes()
    if stale:
        print("[backend] killed leftover process groups from an earlier run: %s" % stale, file=sys.stderr)
    atexit.register(qemu_runner.kill_all)
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, _handle_signal)
    print("[backend] API on http://%s:%d/api   xv6: %s   build-before-run: %s"
          % (config.HOST, config.PORT, config.XV6_PATH, config.BUILD_BEFORE_RUN), flush=True)
    app.run(host=config.HOST, port=config.PORT, threaded=True, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
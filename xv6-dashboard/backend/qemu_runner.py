"""Process control: `make` builds and fresh QEMU/xv6 sessions.

Every child is started in its own session, so its process-group id equals
its pid. One killpg() therefore stops make *and* the qemu (or gcc) it spawned.
Each pgid is kept in memory and in data/active_pgids.json, which lets us
  * clean up from atexit and signal handlers (kill_all), and
  * clean up on the next start if the backend was SIGKILLed (reap_stale_processes).
"""
import json
import os
import signal
import subprocess
import threading
import time

import pexpect

import config


# ----------------------------------------------------------------------------
# registry of live process groups
# ----------------------------------------------------------------------------
class _ProcessRegistry:
    def __init__(self, path):
        self._path = path
        self._lock = threading.Lock()
        self._pgids = set()

    def add(self, pgid):
        with self._lock:
            self._pgids.add(pgid)
            self._save_locked()

    def remove(self, pgid):
        with self._lock:
            self._pgids.discard(pgid)
            self._save_locked()

    def snapshot(self):
        with self._lock:
            return sorted(self._pgids)

    def clear(self):
        with self._lock:
            self._pgids.clear()
            self._save_locked()

    def read_stale(self):
        try:
            with open(self._path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return []
        if not isinstance(data, list):
            return []
        return [x for x in data if isinstance(x, int) and not isinstance(x, bool) and x > 1]

    def _save_locked(self):
        try:
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
            tmp = self._path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(sorted(self._pgids), f)
            os.replace(tmp, self._path)
        except OSError:
            pass


REGISTRY = _ProcessRegistry(config.PGID_FILE)


# ----------------------------------------------------------------------------
# killing process groups
# ----------------------------------------------------------------------------
def _group_exists(pgid):
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def kill_group(pgid, grace=2.0, reap=None):
    """SIGTERM the whole group, wait up to `grace` s, then SIGKILL.

    `reap` (optional) is called while waiting so our own direct child gets
    reaped; otherwise its zombie keeps the group "alive".
    """
    if not pgid or pgid <= 1 or pgid == os.getpgrp():
        return  # never signal ourselves
    try:
        os.killpg(pgid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return
    deadline = time.monotonic() + grace
    while time.monotonic() < deadline:
        if reap is not None:
            try:
                reap()
            except Exception:
                pass
        if not _group_exists(pgid):
            return
        time.sleep(0.05)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    if reap is not None:
        try:
            reap()
        except Exception:
            pass


def kill_all():
    """Kill every process group we started. Safe to call more than once."""
    for pgid in REGISTRY.snapshot():
        kill_group(pgid, grace=1.0)
        REGISTRY.remove(pgid)


def _proc_pgrp(pid):
    with open("/proc/%d/stat" % pid, encoding="utf-8", errors="replace") as f:
        stat = f.read()
    # comm (field 2) may contain spaces/parens, so split after the last ')'
    fields = stat[stat.rfind(")") + 2:].split()
    return int(fields[2])  # state, ppid, pgrp


def _proc_is_ours(pid):
    try:
        with open("/proc/%d/cmdline" % pid, "rb") as f:
            cmd = f.read().replace(b"\0", b" ").decode("utf-8", "replace").strip()
        cwd = os.readlink("/proc/%d/cwd" % pid)
    except OSError:
        return False
    if os.path.realpath(cwd) != os.path.realpath(config.XV6_PATH):
        return False
    first = os.path.basename(cmd.split(" ", 1)[0]) if cmd else ""
    return "qemu-system" in cmd or first == "make"


def reap_stale_processes():
    """Kill groups left over from a backend that died without cleaning up."""
    killed = []
    for pgid in REGISTRY.read_stale():
        if pgid == os.getpgrp():
            continue
        members = []
        for name in os.listdir("/proc"):
            if not name.isdigit():
                continue
            try:
                if _proc_pgrp(int(name)) == pgid:
                    members.append(int(name))
            except (OSError, ValueError, IndexError):
                continue
        if any(_proc_is_ours(p) for p in members):
            try:
                os.killpg(pgid, signal.SIGKILL)
                killed.append(pgid)
            except (ProcessLookupError, PermissionError):
                pass
    REGISTRY.clear()
    return killed


# ----------------------------------------------------------------------------
# make
# ----------------------------------------------------------------------------
def run_make(args, on_line, cancel_event, timeout):
    """Run `make <args>` in XV6_PATH and stream each output line to on_line.

    Returns (ok, reason). reason is "ok", "cancelled", "timeout", or a
    human-readable failure message.
    """
    cmd = ["make"] + list(args)
    env = dict(os.environ, LC_ALL="C")
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=config.XV6_PATH,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            start_new_session=True,
            env=env,
        )
    except OSError as exc:
        return False, "could not start make in %s: %s" % (config.XV6_PATH, exc)

    pgid = proc.pid
    REGISTRY.add(pgid)
    stopped = []  # reason we killed it, if we did
    finished = threading.Event()

    def watchdog():
        deadline = time.monotonic() + timeout
        while not finished.wait(0.2):
            why = None
            if cancel_event.is_set():
                why = "cancelled"
            elif time.monotonic() >= deadline:
                why = "timeout"
            if why:
                stopped.append(why)
                kill_group(pgid, reap=proc.poll)
                return

    threading.Thread(target=watchdog, name="make-watchdog-%d" % pgid, daemon=True).start()
    try:
        for line in proc.stdout:
            on_line(line.rstrip("\r\n"))
        proc.wait()
    finally:
        finished.set()
        if proc.poll() is None:
            kill_group(pgid, reap=proc.poll)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        if proc.stdout:
            proc.stdout.close()
        REGISTRY.remove(pgid)

    if stopped:
        return False, stopped[0]
    if proc.returncode == 0:
        return True, "ok"
    return False, "make %s exited with status %s" % (" ".join(args), proc.returncode)


# ----------------------------------------------------------------------------
# QEMU session
# ----------------------------------------------------------------------------
class _LineEndings:
    """Normalize console output to \\r\\n for xterm.js, even across chunks."""

    def __init__(self):
        self._held_cr = False

    def feed(self, text):
        if self._held_cr:
            text = "\r" + text
            self._held_cr = False
        if text.endswith("\r"):  # may be the first half of "\r\n"
            text = text[:-1]
            self._held_cr = True
        return text.replace("\r\n", "\n").replace("\n", "\r\n")

    def flush(self):
        if self._held_cr:
            self._held_cr = False
            return "\r"
        return ""


class QemuSession:
    """One fresh `make qemu`: boot, run one shell command, quit.

    on_terminal(text) receives every output chunk with \\r\\n line endings.
    The on_text callback given to run_command receives the same text with
    \\n endings (for the parsers), only for output after the command is sent.

    wait_for_prompt / run_command return one of:
      "prompt", "timeout", "cancelled", "eof" (QEMU exited), "panic".
    """

    TAIL_CHARS = 8192

    def __init__(self, on_terminal):
        self._on_terminal = on_terminal
        self._on_text = None
        self._endings = _LineEndings()
        self._tail = ""
        self._child = None
        self._pgid = None

    def start(self):
        self._child = pexpect.spawn(
            config.QEMU_COMMAND[0],
            list(config.QEMU_COMMAND[1:]),
            cwd=config.XV6_PATH,
            encoding="utf-8",
            codec_errors="replace",
            echo=False,
            dimensions=(50, 200),
            timeout=None,
        )
        # The pty child calls setsid(), so its pid is the process-group id.
        # (Do not use os.getpgid() here: it can race with the child's setsid.)
        self._pgid = self._child.pid
        REGISTRY.add(self._pgid)

    def wait_for_prompt(self, cancel_event, timeout):
        return self._pump(cancel_event, timeout)

    def run_command(self, command, cancel_event, timeout, on_text):
        self._tail = ""
        self._on_text = on_text
        try:
            self._child.send(command + "\n")
        except OSError:
            return "eof"
        return self._pump(cancel_event, timeout)

    def _handle(self, data):
        term = self._endings.feed(data)
        if not term:
            return
        self._on_terminal(term)
        text = term.replace("\r\n", "\n")
        self._tail = (self._tail + text)[-self.TAIL_CHARS:]
        if self._on_text is not None:
            self._on_text(text)

    def _pump(self, cancel_event, timeout):
        deadline = time.monotonic() + timeout
        prompt_since = None
        panic_since = None
        while True:
            now = time.monotonic()
            if cancel_event.is_set():
                return "cancelled"
            if panic_since is not None and now - panic_since >= config.PANIC_GRACE_SECONDS:
                return "panic"
            if prompt_since is not None and now - prompt_since >= config.PROMPT_QUIET_SECONDS:
                return "prompt"
            if now >= deadline:
                return "timeout"
            wait = min(0.1, max(0.01, deadline - now))
            try:
                data = self._child.read_nonblocking(size=4096, timeout=wait)
            except pexpect.TIMEOUT:
                continue
            except pexpect.EOF:
                return "eof"
            if not data:
                continue
            self._handle(data)
            if panic_since is None and "panic: " in self._tail:
                panic_since = time.monotonic()
            if panic_since is None and self._tail.endswith("$ "):
                prompt_since = time.monotonic()
            else:
                prompt_since = None

    def close(self):
        """Ctrl-A x, then make sure the whole process group is gone."""
        child = self._child
        if child is None:
            return
        self._on_text = None
        try:
            if child.isalive():
                try:
                    child.send("\x01x")
                except OSError:
                    pass
                deadline = time.monotonic() + config.QEMU_QUIT_GRACE
                while time.monotonic() < deadline:
                    try:
                        data = child.read_nonblocking(size=4096, timeout=0.2)
                    except pexpect.TIMEOUT:
                        if not child.isalive():
                            break
                        continue
                    except (pexpect.EOF, OSError):
                        break
                    if data:
                        self._handle(data)
        except Exception:
            pass
        finally:
            rest = self._endings.flush()
            if rest:
                try:
                    self._on_terminal(rest)
                except Exception:
                    pass
            kill_group(self._pgid, grace=2.0, reap=child.isalive)
            try:
                child.close(force=True)
            except Exception:
                pass
            REGISTRY.remove(self._pgid)
            self._child = None
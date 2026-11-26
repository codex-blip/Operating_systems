"""Output parsers for the xv6 test programs.

Written against the real sources in ~/xv6/user (alarmtest.c, bigfile.c,
symlinktest.c, mmaptest.c) and the run()/drivetests() output format of
usertests.c ("test %s: " ... "OK" / "FAILED", "ALL TESTS PASSED",
"SOME TESTS FAILED", "FAILED -- lost some free pages").

Interface used by app.py:
    p = get_parser(task_id)              # task1..usertests; anything else -> CommandParser
    p.feed(text) -> [Subtest, ...]       # text uses "\n" endings; returns subtests that changed
    p.finish(completed) -> (status, [Subtest, ...])   # status "pass" | "fail"
Subtest = {"name": str, "status": "pass" | "fail" | "running", "detail": str}

Run `python parsers.py` to self-test against sample transcripts.
"""
import re

KERNEL_HINTS = ("usertrap()", "panic:", "scause", "kerneltrap")


class _Parser:
    EXPECTED = ()  # subtests that must all pass, in display order

    def __init__(self):
        self._partial = ""     # current incomplete line
        self._subtests = {}    # name -> Subtest (insertion ordered)
        self._current = None   # name of the most recently started subtest
        self._kernel_msg = ""  # last kernel trap/panic line since that start
        self._updates = []

    # ---------------------------------------------------------------- public
    def feed(self, text):
        lines = (self._partial + text).split("\n")
        self._partial = lines.pop()
        for line in lines:
            self._note_kernel(line)
            self._line(line)
        self._on_partial(bool(lines))
        return self._take_updates()

    def finish(self, completed):
        rest, self._partial = self._partial, ""
        if rest.endswith("$ "):  # the shell prompt that ended the run
            rest = rest[:-2]
        if rest.strip():
            self._note_kernel(rest)
            self._line(rest)
        cur = self._running()
        if cur is not None:
            self._fail(cur, self._unfinished_detail(cur, completed))
        self._take_updates()
        ordered = [
            dict(self._subtests.get(n) or {"name": n, "status": "fail", "detail": "did not run"})
            for n in self.EXPECTED
        ]
        ordered += [dict(st) for n, st in self._subtests.items() if n not in self.EXPECTED]
        ok = (completed and bool(ordered)
              and all(s["status"] == "pass" for s in ordered)
              and self._extra_ok())
        return ("pass" if ok else "fail"), ordered

    # ----------------------------------------------------------------- hooks
    def _line(self, line):
        pass

    def _on_partial(self, had_newline):
        pass

    def _extra_ok(self):
        return True

    def _unfinished_detail(self, name, completed):
        detail = ("ended without printing a pass/fail line" if completed
                  else "stopped before it finished")
        if self._kernel_msg:
            detail += " (last kernel message: %s)" % self._kernel_msg
        return detail

    # --------------------------------------------------------------- helpers
    def _take_updates(self):
        out, self._updates = self._updates, []
        return out

    def _note_kernel(self, line):
        if any(h in line for h in KERNEL_HINTS):
            self._kernel_msg = line.strip()[:160]

    def _running(self):
        st = self._subtests.get(self._current) if self._current else None
        return self._current if st and st["status"] == "running" else None

    def _set(self, name, status, detail=""):
        st = self._subtests.get(name)
        if st is None:
            st = {"name": name, "status": None, "detail": ""}
            self._subtests[name] = st
        if st["status"] == status and st["detail"] == detail:
            return
        st["status"], st["detail"] = status, detail
        self._updates.append(dict(st))

    def _start(self, name):
        prev = self._running()
        if prev is not None and prev != name:
            self._fail(prev, self._unfinished_detail(prev, True))
        self._set(name, "running", "")
        self._current = name
        self._kernel_msg = ""

    def _pass(self, name, detail=""):
        self._set(name, "pass", detail)

    def _fail(self, name, detail):
        st = self._subtests.get(name)
        if st and st["status"] == "fail" and st["detail"]:
            return  # keep the first (most specific) reason
        self._set(name, "fail", detail)

    def _next_expected(self):
        for n in self.EXPECTED:
            if n not in self._subtests:
                return n
        return None

    def _fail_current(self, detail):
        """Attribute a failure line to the running (or already failed) subtest;
        if none, to the next expected subtest that has not started yet."""
        st = self._subtests.get(self._current) if self._current else None
        if st and st["status"] in ("running", "fail"):
            self._fail(self._current, detail)
            return
        name = self._next_expected()
        if name:
            self._fail(name, detail)


# --------------------------------------------------------------------- task1
class AlarmtestParser(_Parser):
    EXPECTED = ("test0", "test1", "test2", "test3")
    START = re.compile(r"\b(test\d+) start\b")
    PASSED = re.compile(r"\b(test\d+) passed\b")
    FAILED = re.compile(r"\b(test\d+) failed: (.*)")
    OTHER = re.compile(r"\b(test\d+): (.+)")  # e.g. "test2: fork failed"

    def __init__(self):
        super().__init__()
        self._alarms = 0

    def _line(self, line):
        if self._running() and "alarm!" in line:
            self._alarms += line.count("alarm!")
        m = self.START.search(line)
        if m:
            self._start(m.group(1))
            self._alarms = 0
            return
        m = self.PASSED.search(line)
        if m:
            n = self._alarms
            self._pass(m.group(1), "handler ran %d time%s" % (n, "" if n == 1 else "s") if n else "")
            return
        m = self.FAILED.search(line)
        if m:
            self._fail(m.group(1), m.group(2).strip())
            return
        m = self.OTHER.search(line)
        if m:
            self._fail(m.group(1), m.group(2).strip())


# -------------------------------------------------------------------- task2a
class BigfileParser(_Parser):
    EXPECTED = ("write", "read")
    TOTAL = 65803
    DOTS_PER_UPDATE = 20  # one '.' per 100 blocks -> an update every 2000 blocks

    def __init__(self):
        super().__init__()
        self._began = False
        self._dots_reported = 0

    def feed(self, text):
        if not self._began:
            self._began = True
            self._start("write")
        return super().feed(text)

    def _on_partial(self, had_newline):
        if had_newline:  # the dot line of the previous phase ended
            self._dots_reported = 0
        cur = self._running()
        if cur is None:
            return
        n = self._partial.count(".")
        if n - self._dots_reported >= self.DOTS_PER_UPDATE:
            self._dots_reported = n
            self._set(cur, "running", "~%d / %d blocks" % (min(n * 100, self.TOTAL), self.TOTAL))

    def _line(self, line):
        m = re.search(r"wrote (\d+) blocks", line)
        if m:
            n = int(m.group(1))
            if n == self.TOTAL:
                self._pass("write", "wrote %d blocks" % n)
            else:
                self._fail("write", "wrote %d blocks, expected %d" % (n, self.TOTAL))
            return
        if "reading bigfile" in line:
            self._start("read")
            return
        if "bigfile done; ok" in line:
            self._pass("read", "read %d blocks back" % self.TOTAL)
            return
        m = re.search(r"bigfile: (.*)", line)
        if m:
            self._fail_current(m.group(1).strip())


# -------------------------------------------------------------------- task2b
class SymlinkParser(_Parser):
    EXPECTED = ("symlinks", "concurrent symlinks")
    FAILURE = re.compile(r"(?:FAILURE|FAILED): (.*)")

    def _line(self, line):
        if "Start: test concurrent symlinks" in line:
            self._start("concurrent symlinks")
        elif "Start: test symlinks" in line:
            self._start("symlinks")
        elif "test concurrent symlinks: ok" in line:
            self._pass("concurrent symlinks")
        elif "test concurrent symlinks: failed" in line:
            self._fail("concurrent symlinks", "a child process exited with an error")
        elif "test symlinks: ok" in line:
            self._pass("symlinks")
        else:
            m = self.FAILURE.search(line)
            if m:
                self._fail_current(m.group(1).strip() or "failed")


# --------------------------------------------------------------------- task3
class MmapParser(_Parser):
    EXPECTED = (
        "basic mmap",
        "mmap private",
        "mmap read-only",
        "mmap read/write",
        "mmap dirty",
        "not-mapped unmap",
        "lazy access",
        "mmap two files",
        "fork",
        "munmap prevents access",
        "writes to read-only mapped memory",
    )
    PASS_RE = re.compile(r"\btest (.+?): OK\s*$")
    START_RE = re.compile(r"^\s*test (.+?)\s*$")
    FAIL_RE = re.compile(r"mmaptest failure: (.*)")

    def __init__(self):
        super().__init__()
        self._all_ok = False
        self._context = ""

    def _extra_ok(self):
        return self._all_ok

    def _line(self, line):
        m = self.PASS_RE.search(line)
        if m:
            self._pass(m.group(1))
            return
        m = self.FAIL_RE.search(line)
        if m:
            detail = m.group(1).strip()
            if self._context:
                detail += " (%s)" % self._context
            self._fail_current(detail)
            return
        if "mmaptest: all tests succeeded" in line:
            self._all_ok = True
            return
        if "fork_test failed" in line:
            self._fail_current("the child process saw a wrong mapping")
            return
        if line.lstrip().startswith("mismatch at "):
            self._context = line.strip()[:160]
            return
        m = self.START_RE.match(line)
        if m and not m.group(1).endswith(":") and len(m.group(1)) <= 60:
            self._start(m.group(1))
            self._context = ""


# ----------------------------------------------------------------- usertests
class UsertestsParser(_Parser):
    START_RE = re.compile(r"test (\S+): ")
    RESULT_RE = re.compile(r"[.\s]*(OK|FAILED)")

    def __init__(self):
        super().__init__()
        self._all_passed = False
        self._some_failed = False
        self._recent = []  # last output lines of the running test

    def _extra_ok(self):
        return self._all_passed and not self._some_failed

    def _recent_text(self):
        return " | ".join(self._recent)

    def _unfinished_detail(self, name, completed):
        detail = super()._unfinished_detail(name, completed)
        if self._recent:
            detail += "; last output: " + self._recent_text()
        return detail

    def _consume_start(self, text):
        """While no test runs, 'test NAME: ' starts one (even mid-line)."""
        if self._running() is None:
            m = self.START_RE.search(text)
            if m:
                self._start(m.group(1))
                self._recent = []
                return text[m.end():]
        return text

    def _on_partial(self, had_newline):
        # show the test as running as soon as "test NAME: " appears
        self._partial = self._consume_start(self._partial)

    def _line(self, line):
        line = self._consume_start(line)
        word = line.strip()
        cur = self._running()
        if cur is not None:
            m = self.RESULT_RE.fullmatch(word)
            if m and m.group(1) == "OK":
                self._pass(cur)
            elif m:
                self._fail(cur, self._recent_text() or "test process exited with non-zero status")
            elif word:
                self._recent = (self._recent + [word[:160]])[-3:]
            return
        if "ALL TESTS PASSED" in line:
            self._all_passed = True
        elif "SOME TESTS FAILED" in line:
            self._some_failed = True
        elif word.startswith("FAILED -- lost some free pages"):
            self._fail("free pages", word)


# ------------------------------------------------------------ free-form cmds
class CommandParser:
    def feed(self, text):
        return []

    def finish(self, completed):
        return ("pass" if completed else "fail"), []


_PARSERS = {
    "task1": AlarmtestParser,
    "task2a": BigfileParser,
    "task2b": SymlinkParser,
    "task3": MmapParser,
    "usertests": UsertestsParser,
}


def get_parser(task_id):
    return _PARSERS.get(task_id, CommandParser)()


# ------------------------------------------------------------------ selftest
def _mmap_ok_transcript():
    out = "mmaptest\n"
    for name in MmapParser.EXPECTED:
        out += "test %s\n" % name
        if name == "munmap prevents access":  # expected child faults
            out += "usertrap(): unexpected scause 0xd pid=7\n            sepc=0x2c stval=0x5000\n"
        out += "test %s: OK\n" % name
    return out + "mmaptest: all tests succeeded\n$ "


_SAMPLES = [
    ("task1", True, "pass",
     "alarmtest\ntest0 start\n...alarm!\ntest0 passed\ntest1 start\n.alarm!\nalarm!\n"
     ".test1 passed\ntest2 start\n.alarm!\ntest2 passed\ntest3 start\ntest3 passed\n$ ",
     {"test0": "pass", "test1": "pass", "test2": "pass", "test3": "pass"}),
    ("task1", True, "fail",
     "alarmtest\ntest0 start\nalarm!\ntest0 passed\ntest1 start\n\ntest1 failed: too few calls "
     "to the handler\ntest2 start\nusertrap(): unexpected scause 0xd pid=4\ntest3 start\n"
     "test3 failed: register a0 changed\n$ ",
     {"test0": "pass", "test1": "fail", "test2": "fail", "test3": "fail"}),
    ("task2a", True, "pass",
     "bigfile\n" + "." * 658 + "\nwrote 65803 blocks\nreading bigfile\n" + "." * 658
     + "\nbigfile done; ok\n$ ",
     {"write": "pass", "read": "pass"}),
    ("task2a", True, "fail",
     "bigfile\n..\nwrote 268 blocks\nbigfile: file is too small\n$ ",
     {"write": "fail", "read": "fail"}),
    ("task2b", True, "pass",
     "symlinktest\nStart: test symlinks\ntest symlinks: ok\nStart: test concurrent symlinks\n"
     "test concurrent symlinks: ok\n$ ",
     {"symlinks": "pass", "concurrent symlinks": "pass"}),
    ("task2b", True, "fail",
     "symlinktest\nStart: test symlinks\nFAILURE: symlink b -> a failed\n"
     "Start: test concurrent symlinks\nFAILED: open failed$ ",
     {"symlinks": "fail", "concurrent symlinks": "fail"}),
    ("task3", True, "pass", _mmap_ok_transcript(),
     {n: "pass" for n in MmapParser.EXPECTED}),
    ("task3", True, "fail",
     "mmaptest\ntest basic mmap\nmismatch at 0, wanted 'A', got 0x0\n"
     "mmaptest failure: v1 mismatch (1), pid=3\n$ ",
     {n: "fail" for n in MmapParser.EXPECTED}),
    ("task3", False, "fail", "mmaptest\ntest basic mmap\n",
     {n: "fail" for n in MmapParser.EXPECTED}),
    ("usertests", True, "pass",
     "usertests\nusertests starting\ntest a: OK\ntest b: OK\nusertests slow tests starting\n"
     "test c: OK\nALL TESTS PASSED\n$ ",
     {"a": "pass", "b": "pass", "c": "pass"}),
    ("usertests", True, "fail",
     "usertests\nusertests starting\ntest copyin: OK\ntest copyout: usertrap(): unexpected "
     "scause 0xd pid=6\n            sepc=0x1c stval=0x0\nOK\ntest bad: bad: something wrong\n"
     "FAILED\nSOME TESTS FAILED\n$ ",
     {"copyin": "pass", "copyout": "pass", "bad": "fail"}),
]


def _selftest():
    bad = 0
    for task, completed, want_status, text, want in _SAMPLES:
        for size in (1, 7, 4096):
            p = get_parser(task)
            for i in range(0, len(text), size):
                p.feed(text[i:i + size])
            status, subtests = p.finish(completed)
            got = {s["name"]: s["status"] for s in subtests}
            if status != want_status or got != want:
                bad += 1
                print("FAIL %-9s chunk=%-4d status=%s subtests=%s" % (task, size, status, subtests))
        print("ok   %-9s -> %-4s %s" % (task, want_status,
              "; ".join("%s=%s%s" % (s["name"], s["status"], " (%s)" % s["detail"] if s["detail"] else "")
                        for s in subtests)))
    print("ALL PARSER SELF-TESTS PASSED" if bad == 0 else "%d PARSER SELF-TEST(S) FAILED" % bad)
    return bad


if __name__ == "__main__":
    raise SystemExit(1 if _selftest() else 0)
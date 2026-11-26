"""Configuration for the xv6 dashboard backend.

Values marked (env) can be overridden with an environment variable of the
same name, e.g.   XV6_PATH=~/other-xv6 BUILD_BEFORE_RUN=0 python app.py
"""
import os


def _env_int(name, default):
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_bool(name, default):
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


# ---- paths ------------------------------------------------------------------
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
HISTORY_FILE = os.path.join(DATA_DIR, "history.json")
PGID_FILE = os.path.join(DATA_DIR, "active_pgids.json")  # children we still have to clean up
HISTORY_MAX = 100

XV6_PATH = os.path.abspath(os.path.expanduser(os.environ.get("XV6_PATH", "~/xv6")))  # (env)

# ---- server -----------------------------------------------------------------
HOST = "127.0.0.1"
PORT = _env_int("PORT", 5000)  # (env)
KEEPALIVE_SECONDS = 15

# ---- build ------------------------------------------------------------------
BUILD_BEFORE_RUN = _env_bool("BUILD_BEFORE_RUN", True)  # (env)
MAKE_JOBS = _env_int("MAKE_JOBS", max(1, min(os.cpu_count() or 1, 8)))  # (env)
# Plain `make` in xv6 only builds the kernel. These two targets build the
# kernel, every UPROGS program and fs.img, so `make qemu` has nothing left to do.
BUILD_TARGETS = ["kernel/kernel", "fs.img"]
BUILD_TIMEOUT = _env_int("BUILD_TIMEOUT", 900)  # seconds, per make invocation (env)

# ---- qemu -------------------------------------------------------------------
QEMU_COMMAND = ["make", "qemu"]
BOOT_TIMEOUT = _env_int("BOOT_TIMEOUT", 120)  # boot -> first "$ " prompt (env)
PROMPT_QUIET_SECONDS = 0.3  # "$ " must be followed by this much silence to count as the prompt
PANIC_GRACE_SECONDS = 1.0   # keep reading this long after "panic: " so the message is complete
QEMU_QUIT_GRACE = 5.0       # wait this long after Ctrl-A x before killing the process group

# ---- free-form commands -----------------------------------------------------
COMMAND_TIMEOUT = 60
MAX_COMMAND_LENGTH = 98  # xv6 sh's gets() keeps at most 99 bytes including the '\n'

# ---- git --------------------------------------------------------------------
GIT_BASE_COMMIT = "79e8024"
GIT_BRANCH = "project"
DIFF_PREFIXES = {
    "task1": "task1:",
    "task2a": "task2a:",
    "task2b": "task2b:",
    "task3": "task3:",
}

# ---- tasks (order here = order in GET /tasks) -------------------------------
# "timeout" covers only the test command itself (boot has BOOT_TIMEOUT).
# "est_seconds" are rough estimates for the progress UI.
TASKS = {
    "task1": {
        "name": "Alarm (sigalarm / sigreturn)",
        "description": "Periodic user-level timer handler; alarmtest runs test0-test3.",
        "command": "alarmtest",
        "timeout": 120,
        "est_seconds": 20,
    },
    "task2a": {
        "name": "Large files (doubly-indirect blocks)",
        "description": "bigfile writes and reads back a 65,803-block file.",
        "command": "bigfile",
        "timeout": 600,
        "est_seconds": 180,
    },
    "task2b": {
        "name": "Symbolic links",
        "description": "symlink() and O_NOFOLLOW, including cycles and concurrent links.",
        "command": "symlinktest",
        "timeout": 120,
        "est_seconds": 20,
    },
    "task3": {
        "name": "mmap / munmap",
        "description": "Lazy file-backed mappings, MAP_SHARED write-back, munmap and fork.",
        "command": "mmaptest",
        "timeout": 180,
        "est_seconds": 40,
    },
    "usertests": {
        "name": "usertests (regression)",
        "description": "The full xv6 regression suite; must still pass after every task.",
        "command": "usertests",
        "timeout": 1800,
        "est_seconds": 600,
    },
}
RUN_ALL_ORDER = ["task1", "task2a", "task2b", "task3"]
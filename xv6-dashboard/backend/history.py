"""Run history persisted to data/history.json (newest first, max 100).

Each stored item holds the public HistoryItem fields plus the full Result
under "result" (used to rebuild /status last_results after a restart).
GET /history only returns the public fields.
"""
import json
import os
import sys
import threading
import time

PUBLIC_FIELDS = ("run_id", "task", "status", "duration", "started_at", "passed", "total")


def _public(item):
    return {k: item.get(k) for k in PUBLIC_FIELDS}


class History:
    def __init__(self, path, max_items=100):
        self._path = path
        self._max = max_items
        self._lock = threading.Lock()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self._items = self._load()

    def _load(self):
        try:
            with open(self._path, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return []
        except (OSError, ValueError) as exc:
            backup = "%s.corrupt-%d" % (self._path, int(time.time()))
            try:
                os.replace(self._path, backup)
                print("[history] unreadable history (%s); moved to %s" % (exc, backup), file=sys.stderr)
            except OSError:
                pass
            return []
        if not isinstance(data, list):
            return []
        items = [x for x in data if isinstance(x, dict) and "run_id" in x and "task" in x]
        return items[: self._max]

    def _save_locked(self):
        tmp = self._path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._items, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self._path)
        except OSError as exc:
            print("[history] could not save %s: %s" % (self._path, exc), file=sys.stderr)

    def add(self, run_id, task, started_at, result):
        subtests = result.get("subtests") or []
        item = {
            "run_id": run_id,
            "task": task,
            "status": result.get("status"),
            "duration": result.get("duration"),
            "started_at": started_at,
            "passed": sum(1 for s in subtests if s.get("status") == "pass"),
            "total": len(subtests),
            "result": result,
        }
        with self._lock:
            self._items.insert(0, item)
            del self._items[self._max:]
            self._save_locked()
        return _public(item)

    def public_items(self):
        with self._lock:
            return [_public(i) for i in self._items]

    def latest_results(self):
        """{task_id: Result} for the newest stored run of each task."""
        latest = {}
        with self._lock:
            for item in self._items:  # newest first
                task = item.get("task")
                if task not in latest and isinstance(item.get("result"), dict):
                    latest[task] = item["result"]
        return latest
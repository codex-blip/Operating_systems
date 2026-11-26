#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:5000/api}"
FULL=0
if [[ "${1:-}" == "--full" ]]; then
  FULL=1
elif [[ $# -gt 0 ]]; then
  printf 'Usage: %s [--full]\n' "$0" >&2
  exit 2
fi

for command in curl python3; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$command" >&2
    exit 1
  fi
done

tmpdir="$(mktemp -d)"
run_pid=
sse_count=0
cleanup() {
  if [[ -n "$run_pid" ]]; then
    curl -fsS -X POST "$BASE_URL/cancel" >/dev/null 2>&1 || true
    wait "$run_pid" 2>/dev/null || true
  fi
  rm -rf -- "$tmpdir"
}
trap cleanup EXIT INT TERM

check_json() {
  local url="$1"
  local kind="$2"
  curl -fsS "$url" |
    python3 -c '
import json, sys
data = json.load(sys.stdin)
kind = sys.argv[1]
if kind == "health":
    assert data.get("status") == "ok" and data.get("qemu") in ("idle", "running"), data
elif kind == "tasks":
    assert isinstance(data, list) and {t["id"] for t in data} >= {"task1", "task2a", "task2b", "task3", "usertests"}, data
elif kind == "status":
    assert data.get("state") in ("idle", "building", "running") and "last_results" in data, data
elif kind == "history":
    assert isinstance(data, list) and len(data) <= 100, data
elif kind == "diff":
    assert data.get("task") == sys.argv[2] and isinstance(data.get("commits"), list) and isinstance(data.get("diff"), str), data
else:
    raise AssertionError("unknown response kind: " + kind)
' "$kind" "${3:-}"
  printf 'PASS GET %s\n' "${url#"$BASE_URL"}"
}

check_sse() {
  local path="$1"
  local body="$2"
  local timeout="${3:-120}"
  local capture
  sse_count=$((sse_count + 1))
  capture="$tmpdir/sse-$sse_count.txt"
  printf '\n--- POST %s ---\n' "$path"
  curl -fsS -N --max-time "$timeout" \
    -H 'Content-Type: application/json' \
    -d "$body" "$BASE_URL$path" | tee "$capture"
  printf '\n'
  python3 -c '
import json, sys
events = []
for line in open(sys.argv[1], encoding="utf-8"):
    if line.startswith("data: "):
        events.append(json.loads(line[6:]))
assert events, "SSE response had no data events"
terminal = events[-1]
assert terminal.get("type") in ("finished", "all_finished"), terminal
if terminal["type"] == "finished":
    result = terminal.get("result")
    assert isinstance(result, dict) and result.get("status") == "pass", terminal
elif terminal["type"] == "all_finished":
    results = terminal.get("results")
    assert isinstance(results, dict) and results, terminal
    assert all(result.get("status") == "pass" for result in results.values()), terminal
print("PASS SSE terminal event:", terminal["type"])
' "$capture"
}

check_json "$BASE_URL/health" health
check_json "$BASE_URL/tasks" tasks
check_json "$BASE_URL/status" status
check_json "$BASE_URL/history" history

for task in task1 task2a task2b task3; do
  check_json "$BASE_URL/diff/$task" diff "$task"
done

http_code="$(curl -sS -o "$tmpdir/unknown-task.json" -w '%{http_code}' \
  -X POST -H 'Content-Type: application/json' -d '{}' "$BASE_URL/run/not-a-task")"
[[ "$http_code" == "404" ]] || { printf 'Expected unknown task HTTP 404, got %s\n' "$http_code" >&2; exit 1; }
printf 'PASS POST /run/not-a-task -> HTTP 404\n'

http_code="$(curl -sS -o "$tmpdir/bad-command.json" -w '%{http_code}' \
  -X POST -H 'Content-Type: application/json' -d '{"command":"ls\npwd"}' "$BASE_URL/command")"
[[ "$http_code" == "400" ]] || { printf 'Expected invalid command HTTP 400, got %s\n' "$http_code" >&2; exit 1; }
printf 'PASS POST /command rejects embedded newlines\n'

check_sse /rebuild '{"clean":false}' 960
check_sse /command '{"command":"ls"}' 180

printf '\n--- POST /run/task1 for busy/cancel checks ---\n'
curl -fsS -N --max-time 1800 -H 'Content-Type: application/json' -d '{}' \
  "$BASE_URL/run/task1" >"$tmpdir/cancelled-run.sse" &
run_pid=$!

active=0
for _ in $(seq 1 120); do
  state="$(curl -fsS "$BASE_URL/status" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["state"])')"
  if [[ "$state" != "idle" ]]; then
    active=1
    break
  fi
  sleep 1
done
if [[ "$active" -ne 1 ]]; then
  printf 'Run did not become active within 120 seconds\n' >&2
  exit 1
fi

http_code="$(curl -sS -o "$tmpdir/busy.json" -w '%{http_code}' \
  -X POST -H 'Content-Type: application/json' -d '{}' "$BASE_URL/run/task1")"
[[ "$http_code" == "409" ]] || { printf 'Expected busy HTTP 409, got %s\n' "$http_code" >&2; exit 1; }
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d.get("error")=="busy" and d.get("current_task"), d' "$tmpdir/busy.json"
printf 'PASS concurrent POST /run/task1 -> HTTP 409 busy\n'

curl -fsS -X POST "$BASE_URL/cancel" >"$tmpdir/cancel.json"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d.get("ok") is True and d.get("cancelled") is True, d' "$tmpdir/cancel.json"
wait "$run_pid"
run_pid=
python3 -c '
import json, sys
events = [json.loads(line[6:]) for line in open(sys.argv[1], encoding="utf-8") if line.startswith("data: ")]
assert events, "cancelled run SSE had no data events"
terminal = events[-1]
assert terminal.get("type") == "finished", terminal
assert terminal.get("result", {}).get("status") == "cancelled", terminal
print("PASS POST /cancel and cancelled run SSE completion")
' "$tmpdir/cancelled-run.sse"

if [[ "$FULL" -eq 1 ]]; then
  for task in task1 task2a task2b task3 usertests; do
    timeout=2400
    if [[ "$task" == "usertests" ]]; then
      timeout=3000
    fi
    check_sse "/run/$task" '{}' "$timeout"
  done
  check_sse /run-all '{}' 5000
fi

printf '\nAll curl integration checks passed.\n'

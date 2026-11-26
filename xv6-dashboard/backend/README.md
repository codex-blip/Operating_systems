# xv6 Dashboard Backend

The Flask service in `backend/` builds and boots the xv6 checkout at
`~/xv6` by default. Run these commands from the dashboard directory in WSL2.

## Start

```sh
cd ~/xv6-dashboard
chmod +x start.sh
./start.sh
```

Set `XV6_PATH` if your checkout is somewhere other than `~/xv6`:

```sh
XV6_PATH="$HOME/xv6" ./start.sh
```

`start.sh` starts the Flask backend and starts the frontend too if
`frontend/package.json` exists. Press Ctrl-C to stop the started services.
The backend listens on `http://127.0.0.1:5000/api`.

The backend's optional automatic build is enabled by default. Set
`BUILD_BEFORE_RUN=0` to skip it, or `PORT=...` to use another port.

### Port 5000 is already in use

This usually means another dashboard backend is still running. Stop that
dashboard with Ctrl-C in its terminal, then run `./start.sh` again. If you
want to run both dashboards, use a different backend port and point the
frontend at it too:

```sh
PORT=5001 VITE_API_BASE_URL=http://127.0.0.1:5001/api ./start.sh
```

The startup message prints the backend's actual port. `PORT` alone changes
the backend port, but the frontend otherwise continues to use port 5000.

## API

All POST endpoints accept JSON. Run streams use Server-Sent Events (SSE);
`curl -N` disables curl's output buffering so progress appears as it arrives.

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Backend/QEMU health and xv6 path |
| `GET /tasks` | Available test tasks |
| `GET /status` | Current run and most recent results |
| `GET /history` | Up to 100 recent task results |
| `GET /diff/<task>` | Committed or working-tree diff for a task |
| `POST /run/<task>` | Run `task1`, `task2a`, `task2b`, `task3`, or `usertests` |
| `POST /run-all` | Run the four project tasks in sequence |
| `POST /command` | Run a single xv6 shell command |
| `POST /rebuild` | Rebuild xv6; `{"clean":true}` cleans first |
| `POST /cancel` | Cancel the active build or run |

When another run is active, a run/rebuild request returns HTTP 409 with
`{"error":"busy","current_task":"..."}`. A run starts a fresh QEMU instance.

## Curl integration checks

Keep the `start.sh` terminal open. In another WSL terminal run:

```sh
cd ~/xv6-dashboard
chmod +x backend/curl_tests.sh
./backend/curl_tests.sh
```

The script checks the JSON GET endpoints and all four task diff endpoints,
invalid requests, a rebuild, the `/command` `ls` run, busy handling, and
cancellation. Rebuild and cancellation checks invoke xv6/QEMU. To additionally
run each task endpoint and `/run-all` (including the slow `bigfile` test), use:

```sh
./backend/curl_tests.sh --full
```

Run an individual task manually:

```sh
curl -N -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:5000/api/run/task1
```

The full `bigfile` test writes and reads 65,803 blocks and can take a long
time. For a short demonstration that still crosses from single-indirect into
double-indirect block mapping, build and run the separate `bigfiledemo` program:

```sh
cd ~/xv6
make fs.img
make qemu
```

At the xv6 `$` prompt, run `bigfiledemo`. It writes 512 blocks, reads them back
to verify their contents, removes its temporary file, and prints a `PASS`
summary. It completed in under a minute in the project QEMU setup. From the
dashboard, enter `bigfiledemo` in the terminal command field instead. The full
`bigfile` correctness test remains unchanged.

Run a shell command manually:

```sh
curl -N -H 'Content-Type: application/json' \
  -d '{"command":"ls"}' http://127.0.0.1:5000/api/command
```

Cancel an active operation from another terminal:

```sh
curl -sS -X POST http://127.0.0.1:5000/api/cancel
```

To include xv6's full regression test after the project tasks:

```sh
curl -N -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:5000/api/run/usertests
```

## xv6 user test programs

The xv6 Makefile's unconditional `UPROGS` list should include `_alarmtest`,
`_bigfile`, `_symlinktest`, and `_mmaptest`. The source files must be present
in `~/xv6/user/` before building. From the xv6 checkout:

```sh
cd ~/xv6
make clean
make fs.img
```

The Flask backend's default build targets (`kernel/kernel` and `fs.img`) build
the kernel and user programs before a dashboard task run.

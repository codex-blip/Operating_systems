# xv6 Kernel Lab frontend

Presentation-ready React + TypeScript dashboard for the CS-303 xv6 kernel
project. This folder is self-contained and contains only the browser UI; the
Flask API remains a separate service.

## Run locally

```sh
npm install
npm run dev
```

Mock mode is on by default. It simulates streamed test runs and outputs, keeps
results in the current browser session, and works without the backend.

## Connect to Flask

Open **Settings**, turn off **Mock mode**, and use the default API URL:
`http://127.0.0.1:5000/api`. The API base URL can be changed there and is saved
in local storage. Start the separate backend from the dashboard root:

```sh
cd ~/xv6-dashboard && ./start.sh
```

The initial API settings can also be supplied at build/dev time:

```sh
VITE_USE_MOCK=false VITE_API_BASE_URL=http://127.0.0.1:5000/api npm run dev
```

Runtime settings saved in local storage take precedence. Use the Settings
switches to preview a simulated test failure or an offline backend state.
The **How it works** tab includes interactive visual explainers for alarms,
large-file block mapping, symbolic-link resolution, and mmap page faults.

The production frontend bundle can be generated with `npm run build`; the
result is written to `dist/`.

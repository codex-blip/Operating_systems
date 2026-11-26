import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Toaster, toast } from 'sonner'
import {
  ArrowUpRight, Check, ChevronRight, Command as CommandIcon, HardDrive,
  Cpu, GitBranch, Menu, Play, Radio, Sparkles, Square, TerminalSquare,
} from 'lucide-react'
import TaskCard from './components/TaskCard'
import TerminalPanel from './components/TerminalPanel'
import DiffPanel from './components/DiffPanel'
import ExplainerPanel from './components/ExplainerPanel'
import SettingsPopover from './components/SettingsPopover'
import StatusPill from './components/StatusPill'
import CommandPalette, { type PaletteAction } from './components/CommandPalette'
import { HistoryPanel, RunControls } from './components/RunControls'
import { makeClient } from './api/client'
import { createDefaultResult } from './api/mockClient'
import { loadSettings, saveSettings, type RuntimeSettings } from './config'
import type { BackendStatus, HistoryItem, Result, StreamEvent, StreamRequest, Task, TaskId, TaskStatus } from './api/types'
import './App.css'

const Hero3D = lazy(() => import('./components/Hero3D'))

const fallbackTasks: Task[] = [
  { id: 'task1', name: 'Periodic Alarms', description: 'User-level timer interrupts with sigalarm and sigreturn.', command: 'alarmtest', est_seconds: 5 },
  { id: 'task2a', name: 'Large Files', description: 'Doubly-indirect blocks expand xv6 capacity to 65,803 blocks.', command: 'bigfile', est_seconds: 215 },
  { id: 'task2b', name: 'Symbolic Links', description: 'Path resolution follows links safely with cycle protection.', command: 'symlinktest', est_seconds: 8 },
  { id: 'task3', name: 'Memory-Mapped Files', description: 'Lazy file-backed pages, shared writeback, and fork support.', command: 'mmaptest', est_seconds: 5 },
  { id: 'usertests', name: 'Full Regression Suite', description: 'The full xv6 userspace regression suite.', command: 'usertests', est_seconds: 600 },
]

type RunState = 'idle' | 'building' | 'running' | 'offline'
type Tab = 'terminal' | 'diff' | 'explain'

const showError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'mock-offline' || message.includes('Failed to fetch') || message.includes('NetworkError')) return 'offline'
  toast.error(message || 'Something went wrong.')
  return 'error'
}

const formatElapsed = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export default function App() {
  const [settings, setSettings] = useState<RuntimeSettings>(loadSettings)
  const client = useMemo(() => makeClient(settings), [settings])
  const [tasks, setTasks] = useState<Task[]>(fallbackTasks)
  const [results, setResults] = useState<Record<string, Result>>({})
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [serverStatus, setServerStatus] = useState<BackendStatus>({ state: 'idle', current_task: null, run_id: null, last_results: {} })
  const [runState, setRunState] = useState<RunState>('idle')
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [runningTask, setRunningTask] = useState<TaskId | null>(null)
  const [runningLabel, setRunningLabel] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<TaskId>('task1')
  const [selectedHero, setSelectedHero] = useState<TaskId | 'bigfiledemo'>('task1')
  const [tab, setTab] = useState<Tab>('terminal')
  const [output, setOutput] = useState<string[]>([])
  const [demoMode, setDemoMode] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const controllerRef = useRef<AbortController | null>(null)
  const runningTaskRef = useRef<TaskId | null>(null)

  const refresh = useCallback(async (initial = false) => {
    try {
      const [health, nextTasks, status, nextHistory] = await Promise.all([client.health(), client.tasks(), client.status(), client.history()])
      setTasks(nextTasks)
      setServerStatus(status)
      setHistory(nextHistory)
      setResults((current) => ({
        ...status.last_results,
        ...Object.fromEntries(Object.entries(current).filter(([, result]) => result.status === 'running')),
      }))
      setOffline(false)
      if (health.status !== 'ok') setOffline(true)
    } catch (error) {
      const result = showError(error)
      setOffline(result === 'offline')
    } finally {
      if (initial) setLoading(false)
    }
  }, [client])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void refresh(true) }, 0)
    const timer = window.setInterval(() => { void refresh() }, 5000)
    return () => { window.clearTimeout(initialLoad); window.clearInterval(timer) }
  }, [refresh])

  useEffect(() => { saveSettings(settings) }, [settings])

  useEffect(() => {
    const openHistory = () => setHistoryOpen(true)
    const closeDemo = (event: KeyboardEvent) => { if (event.key === 'Escape') setDemoMode(false) }
    window.addEventListener('show-history', openHistory)
    window.addEventListener('keydown', closeDemo)
    return () => { window.removeEventListener('show-history', openHistory); window.removeEventListener('keydown', closeDemo) }
  }, [])

  const reportedState = runState === 'idle' ? serverStatus.state : runState
  const active = reportedState === 'running' || reportedState === 'building'

  useEffect(() => {
    if (!active) return
    const started = Date.now()
    const tick = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => window.clearInterval(tick)
  }, [active])

  const displayElapsed = active ? elapsedSec : 0

  const append = (text: string) => setOutput((value) => [...value.slice(-1300), text])

  const updateResult = (task: string, result: Result) => {
    setResults((value) => ({ ...value, [task]: result }))
    setHistory((value) => [{
      run_id: `ui-${Date.now()}`, task, status: result.status, duration: result.duration, started_at: result.finished_at,
      passed: result.subtests.filter((test) => test.status === 'pass').length, total: result.subtests.length,
    }, ...value].slice(0, 100))
  }

  function isTask(value: string): value is TaskId {
    return fallbackTasks.some((task) => task.id === value)
  }

  const handleEvent = (event: StreamEvent) => {
    if (event.type === 'started') {
      setRunState(event.task === 'rebuild' ? 'building' : 'running')
      setRunningLabel(event.task)
    } else if (event.type === 'build') {
      append(`${event.line}\r\n`)
    } else if (event.type === 'output') {
      append(event.data)
    } else if (event.type === 'task_started') {
      const task = event.task
      if (isTask(task)) {
        setRunningTask(task)
        runningTaskRef.current = task
        setRunningLabel(task)
        setSelectedTask(task)
        setSelectedHero(task)
        setResults((value) => ({ ...value, [task]: { ...createDefaultResult(task), status: 'running' } }))
        setRunState('running')
      }
    } else if (event.type === 'subtest') {
      const task = runningTaskRef.current
      if (!task) return
      setResults((value) => {
        const prior = value[task] || createDefaultResult(task)
        return {
          ...value,
          [task]: {
            ...prior,
            status: 'running',
            subtests: [
              ...prior.subtests.filter((test) => test.name !== event.name),
              { name: event.name, status: event.status, detail: event.detail },
            ],
          },
        }
      })
    } else if (event.type === 'task_finished') {
      updateResult(event.task, event.result)
    } else if (event.type === 'finished') {
      updateResult(event.task, event.result)
      toast[event.result.status === 'pass' ? 'success' : 'error'](`${event.task}: ${event.result.status}`, { description: `${event.result.duration.toFixed(1)} seconds` })
      setRunState('idle')
      setRunningTask(null)
      runningTaskRef.current = null
      setRunningLabel(null)
      setServerStatus((value) => ({ ...value, state: 'idle', current_task: null, run_id: null }))
      controllerRef.current = null
    } else if (event.type === 'all_finished') {
      Object.entries(event.results).forEach(([task, result]) => updateResult(task, result))
      setRunState('idle')
      setRunningTask(null)
      runningTaskRef.current = null
      setRunningLabel(null)
      setServerStatus((value) => ({ ...value, state: 'idle', current_task: null, run_id: null }))
      controllerRef.current = null
      const failures = Object.values(event.results).filter((result) => result.status !== 'pass').length
      toast[failures ? 'error' : 'success'](failures ? `${failures} task${failures === 1 ? '' : 's'} need attention` : 'All project tasks passed')
    } else if (event.type === 'error') {
      append(`\r\n\x1b[31m${event.code}: ${event.message}\x1b[0m\r\n`)
      setRunState('idle')
      setRunningTask(null)
      runningTaskRef.current = null
      setRunningLabel(null)
      controllerRef.current = null
      toast.error(event.code === 'busy' ? 'Another run is already active' : event.message)
      void refresh()
    }
  }

  const start = async (request: StreamRequest) => {
    if (controllerRef.current) { toast.warning('A test is already running.'); return }
    if (offline) { toast.error('Backend is offline. Start the dashboard backend first.'); return }

    const activeId: TaskId | null = request.kind === 'run' ? request.task : request.kind === 'runAll' ? 'task1' : null
    setRunningTask(activeId)
    runningTaskRef.current = activeId
    setRunningLabel(
      request.kind === 'rebuild' ? (request.clean ? 'clean rebuild' : 'rebuild')
        : request.kind === 'command' ? request.command
          : activeId || 'run-all',
    )

    if (activeId) {
      setSelectedTask(activeId)
      setSelectedHero(activeId)
      setResults((value) => ({ ...value, [activeId]: { ...createDefaultResult(activeId), status: 'running' } }))
    }
    setTab('terminal')
    setElapsedSec(0)
    setRunState(request.kind === 'rebuild' ? 'building' : 'running')

    const controller = new AbortController()
    controllerRef.current = controller
    try {
      await client.stream(request, handleEvent, controller.signal)
      if (controllerRef.current === controller) {
        setRunState('idle')
        setRunningTask(null)
        runningTaskRef.current = null
        setRunningLabel(null)
        controllerRef.current = null
      }
      void refresh()
    } catch (error) {
      if (controller.signal.aborted) return
      if (showError(error) === 'offline') setOffline(true)
      setRunState('idle')
      setRunningTask(null)
      runningTaskRef.current = null
      setRunningLabel(null)
      controllerRef.current = null
    }
  }

  const stop = async () => {
    const controller = controllerRef.current
    if (!controller) {
      if (serverStatus.state === 'idle') return
      try {
        const result = await client.cancel()
        toast[result.cancelled ? 'message' : 'warning'](result.cancelled ? 'Backend run cancelled' : 'No active backend run to cancel')
        void refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not cancel backend run.')
      }
      return
    }
    const cancellation = client.cancel()
    controller.abort()
    controllerRef.current = null
    setRunState('idle')
    setRunningTask(null)
    runningTaskRef.current = null
    setRunningLabel(null)
    append('\r\n\x1b[33m[dashboard] run cancelled\x1b[0m\r\n')
    toast.message('Run stopped')
    try { await cancellation } catch { toast.warning('The stream stopped locally, but the backend did not confirm cancellation.') }
    void refresh()
  }

  const clearTerminal = () => setOutput([])

  const commandAction = (action: PaletteAction) => {
    if (action === 'all') void start({ kind: 'runAll' })
    else if (action === 'cancel') void stop()
    else if (action === 'clear') clearTerminal()
    else if (action === 'demo') setDemoMode((value) => !value)
    else if (action === 'rebuild') void start({ kind: 'rebuild', clean: false })
    else if (action === 'bigfiledemo') { setSelectedHero('bigfiledemo'); void start({ kind: 'command', command: 'bigfiledemo' }) }
    else if (action === 'usertests' || action === 'task1' || action === 'task2a' || action === 'task2b' || action === 'task3') void start({ kind: 'run', task: action })
  }

  const statusList = Object.fromEntries(fallbackTasks.slice(0, 4).map((task) => [task.id, results[task.id]?.status || 'idle'])) as Record<string, TaskStatus>
  const passed = fallbackTasks.slice(0, 4).filter((task) => results[task.id]?.status === 'pass').length
  const onlineStatus = offline ? 'offline' : reportedState === 'building' ? 'building' : reportedState === 'running' ? 'running' : 'idle'
  const currentRunningTask: TaskId | null = runningTask ?? (serverStatus.current_task && isTask(serverStatus.current_task) ? serverStatus.current_task : null)

  return (
    <div className={`app-shell ${demoMode ? 'demo-mode' : ''}`}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      {demoMode && (
        <button className="demo-exit" onClick={() => setDemoMode(false)}>
          Exit demo <kbd>ESC</kbd>
        </button>
      )}

      <header className="topbar">
        <a className="brand" href="#" aria-label="xv6 Kernel Lab home">
          <span className="brand-mark"><Cpu size={18} /></span>
          <span className="brand-copy">
            <strong>xv6 <b>Kernel Lab</b></strong>
            <small>CS-303 · OPERATING SYSTEMS</small>
          </span>
        </a>

        <div className="header-center">
          <span className={`connection-dot ${offline ? 'dot-offline' : active ? 'dot-active' : ''}`} />
          <span>
            {offline ? 'Backend offline'
              : settings.useMock ? 'Mock preview'
                : active ? `${onlineStatus} · ${runningLabel || serverStatus.current_task || 'system'}`
                  : 'Connected · QEMU RISC-V'}
          </span>
          <StatusPill status={onlineStatus} />
        </div>

        <div className="header-actions">
          <button
            className={`mode-switch ${settings.useMock ? 'mode-mock' : 'mode-live'}`}
            onClick={() => setSettings((value) => ({ ...value, useMock: !value.useMock }))}
            title="Toggle between live backend and mock preview"
          >
            <span className="mode-dot" />
            {settings.useMock ? 'Mock' : 'Live'}
          </button>
          <button className={`demo-toggle ${demoMode ? 'demo-active' : ''}`} onClick={() => setDemoMode((value) => !value)}>
            <Sparkles size={14} />
            {demoMode ? 'Exit demo' : 'Demo'}
          </button>
          <button className="palette-trigger" onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}>
            <CommandIcon size={14} />
            <span>Actions</span>
            <kbd>⌘K</kbd>
          </button>
          <SettingsPopover settings={settings} onSave={setSettings} />
          <button className="icon-button small-menu" aria-label="Open command palette" onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}>
            <Menu size={18} />
          </button>
        </div>
      </header>

      <main className="page-content">
        <AnimatePresence>
          {offline && (
            <motion.div className="offline-banner" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <div className="offline-icon"><Radio size={16} /></div>
              <div>
                <strong>Can’t reach the xv6 backend</strong>
                <span>Start the Flask service to run live tests, or switch to Mock mode in the top bar.</span>
              </div>
              <code>cd ~/xv6-dashboard &amp;&amp; ./start.sh</code>
              <button onClick={() => void refresh()}>Retry <ArrowUpRight size={14} /></button>
            </motion.div>
          )}
        </AnimatePresence>

        <section className="hero-section">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="eyebrow-line" />
              RISC-V KERNEL LAB · LIVE TEST CONSOLE
            </div>
            <h1>Small kernel.<br /><span>Big ideas.</span></h1>
            <p className="hero-subtitle">
              Periodic alarms, 65,803-block large files, symbolic links, and lazy memory-mapped files — tested live in QEMU.
            </p>
            <div className="hero-buttons">
              <button className="hero-run" onClick={() => void start({ kind: 'runAll' })} disabled={active}>
                <Play size={14} fill="currentColor" />
                {active ? 'Tests running…' : 'Run all tests'}
                <ChevronRight size={15} />
              </button>
              <button
                className="hero-demo"
                onClick={() => { setSelectedHero('bigfiledemo'); void start({ kind: 'command', command: 'bigfiledemo' }) }}
                disabled={active}
              >
                <HardDrive size={14} /> Quick file demo
              </button>
              {active && (
                <button className="hero-stop" onClick={() => void stop()}>
                  <Square size={12} fill="currentColor" /> Stop
                </button>
              )}
            </div>
          </div>

          <div className="hero-visual">
            <Suspense fallback={<div className="hero-fallback"><div className="fallback-core">xv6</div><span>Preparing kernel map…</span></div>}>
              <Hero3D
                passed={passed}
                selected={selectedHero}
                statuses={statusList}
                onSelect={(task) => { setSelectedHero(task); setSelectedTask(task) }}
                onRunDemo={() => { setSelectedHero('bigfiledemo'); void start({ kind: 'command', command: 'bigfiledemo' }) }}
              />
            </Suspense>
            <div className="hero-progress">
              <div className="progress-ring">
                <svg viewBox="0 0 46 46">
                  <circle cx="23" cy="23" r="19" />
                  <circle className="progress-value" cx="23" cy="23" r="19" style={{ strokeDasharray: `${(passed / 4) * 119.4} 119.4` }} />
                </svg>
                <strong>{passed}<small>/4</small></strong>
              </div>
              <div>
                <span>PROGRESS</span>
                <strong>{passed === 4 ? 'All tasks passed' : `${passed} of 4 passed`}</strong>
              </div>
            </div>
            <div className="hero-annotation">
              <span className="annotation-dot" />
              {selectedHero === 'bigfiledemo' ? 'LARGE FILE DEMO' : selectedTask.toUpperCase()}
              <span> · {selectedHero === 'bigfiledemo' ? '512-block run' : 'selected'}</span>
            </div>
          </div>
        </section>

        <section className="tasks-section">
          <div className="section-heading">
            <div>
              <span className="section-eyebrow">THE PROJECT</span>
              <h2>Kernel extensions <span className="subtle-count">04</span></h2>
            </div>
            <span className="section-hint">Click any card to inspect its diff and architecture below</span>
          </div>

          <div className="task-grid">
            {loading
              ? fallbackTasks.slice(0, 4).map((task) => <div className="task-skeleton" key={task.id}><i /><i /><i /><i /></div>)
              : tasks.filter((task) => task.id !== 'usertests').map((task, index) => (
                <motion.div key={task.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                  <TaskCard
                    task={task}
                    result={results[task.id] || createDefaultResult(task.id)}
                    selected={selectedTask === task.id}
                    running={active && currentRunningTask === task.id}
                    busy={active}
                    onRun={() => void start({ kind: 'run', task: task.id })}
                    onSelect={() => { setSelectedHero(task.id); setSelectedTask(task.id) }}
                  />
                </motion.div>
              ))}
          </div>

          <div className="regression-card">
            <div className="regression-icon"><Check size={17} /></div>
            <div className="regression-copy">
              <div><strong>Full system regression</strong><span className="regression-tag">USERTESTS</span></div>
              <p>Verify core xv6 process, memory, and filesystem invariants still pass after all extensions.</p>
            </div>
            <div className="regression-meta">
              <StatusPill status={active && currentRunningTask === 'usertests' ? 'running' : results.usertests?.status || 'idle'} />
              <span>~10 min</span>
            </div>
            <button onClick={() => void start({ kind: 'run', task: 'usertests' })} disabled={active}>
              <Play size={13} fill="currentColor" /> Run suite
            </button>
          </div>
        </section>

        <section className="workspace-section">
          <div className="workspace-heading">
            <div>
              <span className="section-eyebrow">OBSERVE THE SYSTEM</span>
              <h2>Live workspace</h2>
            </div>
            <div className="workspace-meta">
              <span className={active ? 'workspace-live active' : 'workspace-live'}>
                <i />{active ? `STREAMING · ${formatElapsed(displayElapsed)}` : 'READY'}
              </span>
              <span>QEMU · RISC-V 64</span>
            </div>
          </div>

          <div className="workspace-grid">
            <div className="workspace-main">
              <div className="workspace-tabs" role="tablist" aria-label="Workspace panels">
                <button className={tab === 'terminal' ? 'tab-active' : ''} role="tab" aria-selected={tab === 'terminal'} onClick={() => setTab('terminal')}>
                  <TerminalSquare size={15} />Terminal{output.length > 0 && <span className="tab-count">LIVE</span>}
                </button>
                <button className={tab === 'diff' ? 'tab-active' : ''} role="tab" aria-selected={tab === 'diff'} onClick={() => setTab('diff')}>
                  <GitBranch size={15} />Diff
                </button>
                <button className={tab === 'explain' ? 'tab-active' : ''} role="tab" aria-selected={tab === 'explain'} onClick={() => setTab('explain')}>
                  <Sparkles size={15} />How it works
                </button>
                <div className="tab-spacer" />
                <span className="selected-module">{selectedTask}</span>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  className={`workspace-panel ${tab === 'terminal' ? 'terminal-workspace' : ''}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.14 }}
                >
                  {tab === 'terminal'
                    ? <TerminalPanel output={output} busy={active} onCommand={(command) => void start({ kind: 'command', command })} onClear={clearTerminal} selected={selectedTask} />
                    : tab === 'diff'
                      ? <DiffPanel task={selectedTask} client={client} />
                      : <ExplainerPanel task={selectedTask} />}
                </motion.div>
              </AnimatePresence>

              {active && (
                <div className="active-run-bar">
                  <span className="run-spinner" />
                  <span>
                    {runState === 'building' ? 'Building kernel and filesystem' : `Running ${runningLabel || currentRunningTask || 'task'}`}
                    <small> · elapsed {formatElapsed(displayElapsed)}</small>
                  </span>
                  <button onClick={() => void stop()}>
                    <Square size={11} fill="currentColor" /> Stop
                  </button>
                </div>
              )}
            </div>

            <aside className="workspace-sidebar">
              <RunControls
                busy={active}
                state={reportedState}
                current={currentRunningTask}
                results={results}
                onRunAll={() => void start({ kind: 'runAll' })}
                onCancel={() => void stop()}
                onRebuild={(clean) => void start({ kind: 'rebuild', clean })}
                onRunBigfileDemo={() => { setSelectedHero('bigfiledemo'); void start({ kind: 'command', command: 'bigfiledemo' }) }}
                demoMode={demoMode}
              />
              <HistoryPanel history={history} loading={loading} demoMode={demoMode} />
            </aside>
          </div>
        </section>

        <footer className="footer">
          <div className="brand-mark footer-mark"><Cpu size={14} /></div>
          <span>xv6 Kernel Lab</span>
          <i />
          <span>CS-303 Operating Systems</span>
          <span className="footer-right">QEMU RISC-V 64 · 4 kernel extensions</span>
        </footer>
      </main>

      {historyOpen && (
        <div className="history-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryOpen(false) }}>
          <section className="history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title">
            <div className="history-modal-heading">
              <div>
                <span className="section-eyebrow">RUN ARCHIVE</span>
                <h2 id="history-title">All activity</h2>
              </div>
              <button onClick={() => setHistoryOpen(false)} aria-label="Close activity">×</button>
            </div>
            {history.length ? (
              <div className="history-modal-table">
                <table className="history-table">
                  <thead>
                    <tr><th>TIME</th><th>TEST</th><th>RESULT</th><th>DURATION</th></tr>
                  </thead>
                  <tbody>
                    {history.map((item) => (
                      <tr key={`${item.run_id}-${item.task}`}>
                        <td>{new Date(item.started_at).toLocaleString()}</td>
                        <td>{item.task}</td>
                        <td><span className={`history-status hs-${item.status}`}>{item.status}</span></td>
                        <td>{item.duration.toFixed(1)}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="history-empty">No test runs recorded yet.</div>
            )}
          </section>
        </div>
      )}

      <CommandPalette onAction={commandAction} />
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
    </div>
  )
}

import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Ban, Check, Circle, Clock3, HardDrive, Play, RefreshCw, ShieldCheck } from 'lucide-react'
import type { HistoryItem, TaskId, TaskStatus } from '../api/types'
import StatusPill from './StatusPill'

const sequence: { id: TaskId; label: string }[] = [
  { id: 'task1', label: 'Alarms' },
  { id: 'task2a', label: 'Large files' },
  { id: 'task2b', label: 'Symlinks' },
  { id: 'task3', label: 'mmap' },
]

export function RunControls({ busy, state, current, results, onVerifyAll, onRunAll, onCancel, onRebuild, onRunBigfileDemo, demoMode }: {
  busy: boolean
  state: string
  current: string | null
  results: Record<string, { status: TaskStatus }>
  onVerifyAll: () => void
  onRunAll: () => void
  onCancel: () => void
  onRebuild: (clean: boolean) => void
  onRunBigfileDemo: () => void
  demoMode: boolean
}) {
  const passedCount = sequence.filter((step) => results[step.id]?.status === 'pass').length

  return (
    <section className="side-card run-controls">
      <div className="side-card-heading">
        <div>
          <span className="side-eyebrow">CONTROL ROOM</span>
          <h3>Run controls</h3>
        </div>
        <StatusPill status={busy ? (state === 'building' ? 'building' : 'running') : 'idle'} />
      </div>

      <button className="primary-action" onClick={onVerifyAll} disabled={busy}>
        <ShieldCheck size={15} />
        Verify all visually
        <span>~6s</span>
      </button>

      <button className="bigfile-demo-action" onClick={onRunAll} disabled={busy}>
        <Play size={14} fill="currentColor" />
        <span>
          <strong>Run full MIT suites</strong>
          <small>alarm · bigfile · symlink · mmap</small>
        </span>
      </button>

      <button className="bigfile-demo-action" onClick={onRunBigfileDemo} disabled={busy}>
        <HardDrive size={15} />
        <span>
          <strong>Large-file demo</strong>
          <small>512 blocks · ~2s verify</small>
        </span>
        <Play size={12} fill="currentColor" />
      </button>

      <div className="control-pair">
        <button onClick={() => onRebuild(false)} disabled={busy}>
          <RefreshCw size={13} /> Rebuild
        </button>
        <button className="quiet-action" onClick={() => onRebuild(true)} disabled={busy}>
          <RefreshCw size={13} /> Clean build
        </button>
      </div>

      <button className={`stop-full ${busy ? 'stop-enabled' : ''}`} onClick={onCancel} disabled={!busy}>
        <Ban size={13} /> Stop active run
      </button>

      {!demoMode && (
        <div className="run-stepper">
          <div className="stepper-heading">
            <span>PROJECT SEQUENCE</span>
            <span>{passedCount}/4 passed</span>
          </div>
          <div className="stepper">
            {sequence.map((step, index) => {
              const status = results[step.id]?.status
              const active = current === step.id
              const done = status === 'pass'
              return (
                <div className={`step ${done ? 'step-done' : ''} ${active ? 'step-current' : ''}`} key={step.id}>
                  <i>{done ? <Check size={11} /> : active ? <Circle size={8} fill="currentColor" /> : <span>{String(index + 1).padStart(2, '0')}</span>}</i>
                  <span>{step.label}</span>
                  {index < sequence.length - 1 && <b />}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

export function HistoryPanel({ history, loading, demoMode }: { history: HistoryItem[]; loading: boolean; demoMode: boolean }) {
  const chartData = useMemo(
    () => history.slice(0, 8).reverse().map((item, index) => ({ name: String(index + 1).padStart(2, '0'), seconds: item.duration, task: item.task })),
    [history],
  )
  const passed = history.filter((item) => item.status === 'pass').length
  const rate = history.length ? Math.round((passed / history.length) * 100) : 0

  return (
    <>
      {!demoMode && (
        <section className="side-card metrics-card">
          <div className="side-card-heading">
            <div>
              <span className="side-eyebrow">RECENT RUNS</span>
              <h3>Run health</h3>
            </div>
            <span className="rate-chip">{history.length ? `${rate}% pass` : '—'}</span>
          </div>
          <div className="chart-wrap">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 7, right: 3, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mintFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#83e4d8" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#83e4d8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#25302e" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#849490', fontSize: 11 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: '#849490', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: '#151d1c', border: '1px solid #2b3d39', borderRadius: 10, color: '#e5efed', fontSize: 12 }}
                    formatter={(value) => [`${value}s`, 'Duration']}
                  />
                  <Area dataKey="seconds" type="monotone" stroke="#83e4d8" strokeWidth={2} fill="url(#mintFill)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty">
                <span className="chart-line" />
                <span>Run a test to start tracking history</span>
              </div>
            )}
          </div>
          <div className="metrics-foot">
            <span><strong>{history.length}</strong> runs tracked</span>
            <span><Clock3 size={12} /> {history.length ? `${history.reduce((sum, row) => sum + row.duration, 0).toFixed(1)}s total` : 'No runs yet'}</span>
          </div>
        </section>
      )}

      <section className="side-card history-card">
        <div className="side-card-heading">
          <div>
            <span className="side-eyebrow">ACTIVITY</span>
            <h3>Recent history</h3>
          </div>
          <span className="history-count">{history.length > 99 ? '99+' : history.length}</span>
        </div>
        {loading ? (
          <div className="history-skeleton"><i /><i /><i /></div>
        ) : !history.length ? (
          <div className="history-empty"><Clock3 size={18} /><span>Your test runs will appear here.</span></div>
        ) : (
          <div className="history-table-wrap">
            <table className="history-table">
              <thead>
                <tr><th>TEST</th><th>RESULT</th><th>TIME</th></tr>
              </thead>
              <tbody>
                {history.slice(0, demoMode ? 6 : 7).map((item) => (
                  <tr key={`${item.run_id}-${item.task}`}>
                    <td>
                      <strong>{item.task}</strong>
                      <small>{new Date(item.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                    </td>
                    <td>
                      <span className={`history-status hs-${item.status}`}>
                        {item.status === 'pass' ? <Check size={12} /> : <Circle size={9} />}
                        {item.status}
                      </span>
                    </td>
                    <td>{item.duration.toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button className="history-link" onClick={() => window.dispatchEvent(new CustomEvent('show-history'))}>
          View all activity <span>↗</span>
        </button>
      </section>
    </>
  )
}

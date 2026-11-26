import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Ban, Check, Circle, Clock3, HardDrive, Play, RefreshCw, Sparkles } from 'lucide-react'
import type { HistoryItem, TaskId, TaskStatus } from '../api/types'
import StatusPill from './StatusPill'

const sequence: { id: TaskId; label: string }[] = [
  { id: 'task1', label: 'Alarms' }, { id: 'task2a', label: 'Large files' }, { id: 'task2b', label: 'Symlinks' }, { id: 'task3', label: 'mmap' },
]

export function RunControls({ busy, state, current, results, onRunAll, onRunUsertests, onCancel, onRebuild, onRunBigfileDemo, demoMode }: {
  busy: boolean; state: string; current: string | null; results: Record<string, { status: TaskStatus }>; onRunAll: () => void; onRunUsertests: () => void; onCancel: () => void; onRebuild: (clean: boolean) => void; onRunBigfileDemo: () => void; demoMode: boolean
}) {
  return <section className="side-card run-controls">
    <div className="side-card-heading"><div><span className="side-eyebrow">CONTROL ROOM</span><h3>Run controls</h3></div><StatusPill status={busy ? state === 'building' ? 'building' : 'running' : 'idle'} /></div>
    <button className="primary-action" onClick={onRunAll} disabled={busy}><Play size={15} fill="currentColor" /> Run all project tasks <span>4 tests</span></button>
    <button className="bigfile-demo-action" onClick={onRunBigfileDemo} disabled={busy}><HardDrive size={14} /><span><strong>Large-file demo</strong><small>512 blocks · under a minute</small></span><Play size={12} fill="currentColor" /></button>
    <div className="control-pair"><button onClick={onRunUsertests} disabled={busy}><Sparkles size={14} /> Full usertests</button><button onClick={() => onRebuild(false)} disabled={busy}><RefreshCw size={14} /> Rebuild</button></div>
    <div className="control-pair"><button className="quiet-action" onClick={() => onRebuild(true)} disabled={busy}><RefreshCw size={14} /> Clean rebuild</button><button className={`stop-action ${busy ? 'stop-enabled' : ''}`} onClick={onCancel} disabled={!busy}><Ban size={14} /> Stop run</button></div>
    {!demoMode && <div className="run-stepper"><div className="stepper-heading"><span>PROJECT SEQUENCE</span><span>{Object.values(results).filter((result) => result.status === 'pass').length}/4 passed</span></div>
      <div className="stepper">{sequence.map((step, index) => {
        const status = results[step.id]?.status
        const active = current === step.id
        const done = status === 'pass'
        return <div className={`step ${done ? 'step-done' : ''} ${active ? 'step-current' : ''}`} key={step.id}><i>{done ? <Check size={10} /> : active ? <Circle size={8} fill="currentColor" /> : <span>{String(index + 1).padStart(2, '0')}</span>}</i><span>{step.label}</span>{index < sequence.length - 1 && <b />}</div>
      })}</div>
    </div>}
  </section>
}

export function HistoryPanel({ history, loading, demoMode }: { history: HistoryItem[]; loading: boolean; demoMode: boolean }) {
  const chartData = useMemo(() => history.slice(0, 8).reverse().map((item, index) => ({ name: String(index + 1).padStart(2, '0'), seconds: item.duration, task: item.task })), [history])
  const passed = history.filter((item) => item.status === 'pass').length
  const rate = history.length ? Math.round((passed / history.length) * 100) : 0
  return <>
    {!demoMode && <section className="side-card metrics-card">
      <div className="side-card-heading"><div><span className="side-eyebrow">RECENT RUNS</span><h3>Run health</h3></div><span className="rate-chip">{history.length ? `${rate}% pass` : '—'}</span></div>
      <div className="chart-wrap">{chartData.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 7, right: 3, left: -23, bottom: 0 }}><defs><linearGradient id="mintFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7ce6da" stopOpacity={0.28} /><stop offset="100%" stopColor="#7ce6da" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#26312f" vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#778582', fontSize: 10 }} /><YAxis tickLine={false} axisLine={false} tick={{ fill: '#778582', fontSize: 10 }} /><Tooltip contentStyle={{ background: '#151d1c', border: '1px solid #2b3d39', borderRadius: 10, color: '#e5efed', fontSize: 11 }} formatter={(value) => [`${value}s`, 'Duration']} /><Area dataKey="seconds" type="monotone" stroke="#7ce6da" strokeWidth={2} fill="url(#mintFill)" /></AreaChart></ResponsiveContainer> : <div className="chart-empty"><span className="chart-line" /><span>Run a test to start your history</span></div>}</div>
      <div className="metrics-foot"><span><strong>{history.length}</strong> runs tracked</span><span><Clock3 size={12} /> {history.length ? `${history.reduce((sum, row) => sum + row.duration, 0).toFixed(1)}s total` : 'No duration yet'}</span></div>
    </section>}
    <section className="side-card history-card">
      <div className="side-card-heading"><div><span className="side-eyebrow">ACTIVITY</span><h3>Recent history</h3></div><span className="history-count">{history.length > 99 ? '99+' : history.length}</span></div>
      {loading ? <div className="history-skeleton"><i /><i /><i /></div> : !history.length ? <div className="history-empty"><Clock3 size={17} /><span>Your test runs will appear here.</span></div> : <div className="history-table-wrap"><table className="history-table"><thead><tr><th>TEST</th><th>RESULT</th><th>TIME</th></tr></thead><tbody>{history.slice(0, demoMode ? 6 : 7).map((item) => <tr key={`${item.run_id}-${item.task}`}><td><strong>{item.task}</strong><small>{new Date(item.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></td><td><span className={`history-status hs-${item.status}`}>{item.status === 'pass' ? <Check size={11} /> : <Circle size={9} />}{item.status}</span></td><td>{item.duration.toFixed(1)}s</td></tr>)}</tbody></table></div>}
      <button className="history-link" onClick={() => window.dispatchEvent(new CustomEvent('show-history'))}>View all activity <span>↗</span></button>
    </section>
  </>
}

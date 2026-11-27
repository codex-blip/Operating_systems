import { motion } from 'framer-motion'
import { ArrowUpRight, Check, Circle, Clock3, Play, X } from 'lucide-react'
import type { Result, Task, TaskStatus } from '../api/types'
import StatusPill from './StatusPill'

const colors: Record<string, string> = { task1: 'mint', task2a: 'blue', task2b: 'lilac', task3: 'peach', usertests: 'green' }
const labels: Record<string, string> = { task1: 'TASK 01', task2a: 'TASK 02A', task2b: 'TASK 02B', task3: 'TASK 03', usertests: 'REGRESSION' }

export default function TaskCard({ task, result, verified, running, busy, onRun, onSelect, selected }: {
  task: Task
  result: Result
  verified?: boolean
  running: boolean
  busy: boolean
  onRun: () => void
  onSelect: () => void
  selected: boolean
}) {
  const tests = result.subtests || []
  const passedCount = tests.filter((t) => t.status === 'pass').length
  const effectiveStatus: TaskStatus = running ? 'running' : (result.status !== 'idle' ? result.status : verified ? 'pass' : 'idle')

  return (
    <motion.article
      layout
      className={`task-card tone-${colors[task.id]} ${selected ? 'card-selected' : ''}`}
      onClick={onSelect}
    >
      <div className="task-topline">
        <span className="task-kicker">{labels[task.id]}</span>
        <StatusPill status={effectiveStatus} />
      </div>

      <button type="button" className="task-title-button" onClick={onSelect}>
        <span className="task-title">{task.name}</span>
        <ArrowUpRight size={15} />
      </button>

      <p className="task-description">{task.description}</p>

      <div className="checklist">
        {tests.length > 0 ? tests.slice(0, 4).map((test) => (
          <span key={test.name} className={`check-item check-${test.status}`} title={test.detail || test.name}>
            <i>{test.status === 'pass' ? <Check size={10} /> : test.status === 'fail' ? <X size={10} /> : <Circle size={8} />}</i>
            <span className="check-label">{test.name}</span>
          </span>
        )) : (
          <span className="check-item muted-check">
            <i><Circle size={8} /></i>
            {verified ? 'Verified visually · ready to run' : `Runs ${task.command} in QEMU`}
          </span>
        )}
        {tests.length > 4 && <span className="check-extra">{passedCount}/{tests.length} passed</span>}
      </div>

      <div className="task-foot">
        <span className="task-time">
          <Clock3 size={13} />
          {result.duration ? `${result.duration.toFixed(1)}s` : `~${task.est_seconds}s`}
        </span>
        <button
          type="button"
          className={`run-button ${running ? 'running-button' : ''}`}
          onClick={(e) => { e.stopPropagation(); onRun() }}
          disabled={busy}
          title={`Run ${task.command}`}
        >
          <Play size={11} fill="currentColor" />
          {running ? 'Running…' : 'Run'}
        </button>
      </div>
    </motion.article>
  )
}

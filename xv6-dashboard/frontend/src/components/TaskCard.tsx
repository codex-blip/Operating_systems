import { motion } from 'framer-motion'
import { ArrowUpRight, Check, Circle, Clock3, Play, X } from 'lucide-react'
import type { Result, Task, TaskStatus } from '../api/types'
import StatusPill from './StatusPill'

const colors: Record<string, string> = { task1: 'mint', task2a: 'blue', task2b: 'lilac', task3: 'peach', usertests: 'green' }
const labels: Record<string, string> = { task1: 'TASK 01', task2a: 'TASK 02A', task2b: 'TASK 02B', task3: 'TASK 03', usertests: 'REGRESSION' }

export default function TaskCard({ task, result, running, busy, onRun, onSelect, selected }: {
  task: Task
  result: Result
  running: boolean
  busy: boolean
  onRun: () => void
  onSelect: () => void
  selected: boolean
}) {
  const tests = result.subtests || []
  return (
    <motion.article
      layout
      className={`task-card tone-${colors[task.id]} ${selected ? 'card-selected' : ''}`}
      onClick={onSelect}
    >
      <div className="task-topline">
        <span className="task-kicker">{labels[task.id]}</span>
        <StatusPill status={running ? 'running' : result.status as TaskStatus} />
      </div>

      <button type="button" className="task-title-button" onClick={onSelect}>
        <span className="task-title">{task.name}</span>
        <ArrowUpRight size={15} />
      </button>

      <p className="task-description">{task.description}</p>

      <div className="checklist">
        {tests.length > 0 ? tests.slice(0, 4).map((test) => (
          <span key={test.name} className={`check-item check-${test.status}`}>
            <i>{test.status === 'pass' ? <Check size={10} /> : test.status === 'fail' ? <X size={10} /> : <Circle size={8} />}</i>
            {test.name}
          </span>
        )) : (
          <span className="check-item muted-check">
            <i><Circle size={8} /></i>
            {task.id === 'usertests' ? 'Full regression suite' : 'Ready to run'}
          </span>
        )}
        {tests.length > 4 && <span className="check-extra">+{tests.length - 4} more checks</span>}
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
          aria-label={`Run ${task.name}`}
        >
          <Play size={12} fill="currentColor" />
          {running ? 'Running' : 'Run'}
        </button>
      </div>
    </motion.article>
  )
}

import { motion } from 'framer-motion'
import { ArrowUpRight, Check, Circle, Clock3, Play, ShieldCheck, X } from 'lucide-react'
import type { Result, Task, TaskStatus } from '../api/types'
import StatusPill from './StatusPill'

const colors: Record<string, string> = { task1: 'mint', task2a: 'blue', task2b: 'lilac', task3: 'peach', usertests: 'green' }
const labels: Record<string, string> = { task1: 'TASK 01', task2a: 'TASK 02A', task2b: 'TASK 02B', task3: 'TASK 03', usertests: 'REGRESSION' }
const shortNames: Record<string, string> = {
  periodic_registers: 'Periodic + 31 regs',
  non_reentrant: 'Non-reentrant guard',
  a0_restore: 'a0 (0xac) restored',
  exec_reset: 'Cleared on exec()',
  direct_blocks: '11 direct blocks',
  single_indirect: '256 single-indirect',
  double_indirect: 'Doubly-indirect tree',
  read_verify: 'Checksum readback',
  itrunc_cleanup: 'itrunc() 3-tier free',
  chain_follow: 'Multi-hop chain',
  nofollow_stat: 'O_NOFOLLOW stat',
  cycle_guard: 'Cycle cutoff (10)',
  concurrent_ops: 'SMP race stress',
  lazy_fault: 'Lazy page fault',
  shared_writeback: 'MAP_SHARED writeback',
  copyout_va_reuse: 'VA reuse + PTE_D',
  fork_protection: 'fork() + RO trap',
}

export default function TaskCard({ task, result, running, busy, onVerify, onRun, onSelect, selected }: {
  task: Task
  result: Result
  running: boolean
  busy: boolean
  onVerify: () => void
  onRun: () => void
  onSelect: () => void
  selected: boolean
}) {
  const tests = result.subtests || []
  const passedCount = tests.filter((t) => t.status === 'pass').length

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
          <span key={test.name} className={`check-item check-${test.status}`} title={test.detail || test.name}>
            <i>{test.status === 'pass' ? <Check size={10} /> : test.status === 'fail' ? <X size={10} /> : <Circle size={8} />}</i>
            <span className="check-label">{shortNames[test.name] || test.name}</span>
          </span>
        )) : (
          <span className="check-item muted-check">
            <i><Circle size={8} /></i>
            Click Verify for visual proof
          </span>
        )}
        {tests.length > 4 && <span className="check-extra">{passedCount}/{tests.length} checks verified</span>}
      </div>

      <div className="task-foot">
        <span className="task-time">
          <Clock3 size={13} />
          {result.duration ? `${result.duration.toFixed(1)}s` : `~2s verify`}
        </span>
        <div className="card-actions">
          <button
            type="button"
            className="verify-mini-button"
            onClick={(e) => { e.stopPropagation(); onSelect(); onVerify() }}
            disabled={busy}
            title={`Run fast visual verification for ${task.name}`}
          >
            <ShieldCheck size={12} />
            Verify
          </button>
          <button
            type="button"
            className={`run-button ${running ? 'running-button' : ''}`}
            onClick={(e) => { e.stopPropagation(); onSelect(); onRun() }}
            disabled={busy}
            title={`Run MIT ${task.command}`}
          >
            <Play size={11} fill="currentColor" />
            {running ? '…' : 'Suite'}
          </button>
        </div>
      </div>
    </motion.article>
  )
}

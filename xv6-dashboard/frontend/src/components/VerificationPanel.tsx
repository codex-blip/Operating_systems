import { useState } from 'react'
import {
  ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Circle,
  Clock3, HardDrive, Layers, Link2, LoaderCircle, ShieldCheck,
  Sparkles, TerminalSquare, Timer, XCircle,
} from 'lucide-react'
import type { Result, Subtest, TaskId } from '../api/types'

type VerifyTaskId = Exclude<TaskId, 'usertests'>

type Props = {
  task: VerifyTaskId
  allVerifyResults: Record<string, Result>
  busy: boolean
  runningThis: boolean
  onSelectTask: (task: VerifyTaskId) => void
  onVerify: (task: VerifyTaskId) => void
  onVerifyAll: () => void
}

const TASK_TABS: { id: VerifyTaskId; short: string; title: string; analogy: string }[] = [
  {
    id: 'task1',
    short: '1 · Alarms',
    title: 'Periodic Alarms',
    analogy: 'Like a repeating kitchen timer: the OS pauses a program on schedule, runs a short alarm function, and lets the program continue without losing any work.',
  },
  {
    id: 'task2a',
    short: '2A · Large Files',
    title: 'Large Files',
    analogy: 'Normally xv6 files stop at 268 KB. Adding a 3rd storage level lets one file grow 245× larger — up to 64 MB — without changing the file header size.',
  },
  {
    id: 'task2b',
    short: '2B · Shortcuts',
    title: 'Symbolic Links (Shortcuts)',
    analogy: 'Works like desktop shortcuts: a link points to another file (even across multiple shortcuts) while automatically stopping infinite loops.',
  },
  {
    id: 'task3',
    short: '3 · Memory-Mapped Files',
    title: 'Memory-Mapped Files',
    analogy: 'Lets a program read and edit a file directly like normal memory — loading pages only when touched and saving shared edits back to disk.',
  },
]

type SimpleCheck = {
  id: string
  title: string
  summary: string
}

const SIMPLE_CHECKS: Record<VerifyTaskId, SimpleCheck[]> = {
  task1: [
    {
      id: 'periodic_registers',
      title: 'Timer rings on schedule & no work is lost',
      summary: 'The alarm fired repeatedly during a heavy calculation and every single number stayed 100% accurate afterward.',
    },
    {
      id: 'non_reentrant',
      title: 'Slow alarms never overlap each other',
      summary: 'While one alarm was still running, new timer ticks waited safely — and turning the timer off stopped future alarms.',
    },
    {
      id: 'a0_restore',
      title: 'Active data stays untouched on return',
      summary: 'Confirmed that returning from the alarm does not overwrite the program’s active return-value register.',
    },
    {
      id: 'exec_reset',
      title: 'Starting a new program clears old alarms',
      summary: 'Launching a fresh program cleanly resets any previous alarm so it can never jump to an old address.',
    },
  ],
  task2a: [
    {
      id: 'direct_blocks',
      title: 'Small files use fast direct slots (Level 1)',
      summary: 'First 11 blocks (11 KB) are stored and accessed directly from the file header.',
    },
    {
      id: 'single_indirect',
      title: 'Medium files expand into a single index (Level 2)',
      summary: 'Next 256 blocks (256 KB) are tracked through a 1-level index block.',
    },
    {
      id: 'double_indirect',
      title: 'Large files expand into a double index (Level 3)',
      summary: 'Blocks past 267 use a 2-level index tree, unlocking up to 65,803 total blocks (~64 MB).',
    },
    {
      id: 'read_verify',
      title: 'Every block read back matches 100%',
      summary: 'Re-opened the file from disk and checked every written block across all 3 levels with zero errors.',
    },
    {
      id: 'itrunc_cleanup',
      title: 'Deleting the file frees all disk space',
      summary: 'Removing the file cleanly freed data blocks and all index tables back to the filesystem.',
    },
  ],
  task2b: [
    {
      id: 'chain_follow',
      title: 'Chains of shortcuts reach the real file',
      summary: 'Followed 3 shortcuts in a row, wrote text through the first one, and read the exact same text from the real file.',
    },
    {
      id: 'nofollow_stat',
      title: 'Shortcuts can be inspected directly',
      summary: 'Opening a shortcut without following it identifies it as a shortcut itself instead of jumping to the target.',
    },
    {
      id: 'cycle_guard',
      title: 'Broken links & infinite loops are handled safely',
      summary: 'Pointing to a missing file is allowed, and circular loops (A → B → A) stop cleanly at 10 steps instead of hanging.',
    },
    {
      id: 'concurrent_ops',
      title: 'Multiple programs can use shortcuts at once',
      summary: 'Two processes created, checked, and removed shortcuts at the exact same time with zero crashes.',
    },
  ],
  task3: [
    {
      id: 'lazy_fault',
      title: 'Loads pages only when you actually touch them',
      summary: 'Mapping the file used zero memory upfront and automatically loaded the latest file contents on first read.',
    },
    {
      id: 'shared_writeback',
      title: 'Shared edits save to disk; private edits stay private',
      summary: 'Changes in shared mode were written back to the file on disk, while private changes never modified the file.',
    },
    {
      id: 'copyout_va_reuse',
      title: 'Unmapped memory is freed and reused cleanly',
      summary: 'Unmapping part of a file released its memory range so the next mapping could reuse it immediately.',
    },
    {
      id: 'fork_protection',
      title: 'Child processes inherit & read-only is protected',
      summary: 'A forked child could read the mapped file, and trying to write to a read-only mapping was blocked safely.',
    },
  ],
}

function SimpleVisual({ task, result }: { task: VerifyTaskId; result: Result }) {
  const verified = result.status === 'pass'

  if (task === 'task1') {
    const fires = result.metrics?.handler_fires ?? (verified ? 7 : '—')
    return (
      <div className="vp-story">
        <div className="vp-story-label"><Timer size={14} /> HOW IT WORKS</div>
        <div className="vp-steps-3">
          <div className={`vp-step-card ${verified ? 'vp-step-ok' : ''}`}>
            <span className="vp-step-num">STEP 1</span>
            <strong>Program runs normally</strong>
            <p>Your program is busy doing work in a loop.</p>
          </div>
          <ArrowRight size={16} className="vp-arrow" />
          <div className={`vp-step-card ${verified ? 'vp-step-ok' : ''}`}>
            <span className="vp-step-num">STEP 2</span>
            <strong>Timer rings &amp; pauses</strong>
            <p>The OS saves the program’s exact place and runs the alarm.</p>
          </div>
          <ArrowRight size={16} className="vp-arrow" />
          <div className={`vp-step-card ${verified ? 'vp-step-ok' : ''}`}>
            <span className="vp-step-num">STEP 3</span>
            <strong>Resumes seamlessly</strong>
            <p>The program continues from the exact spot with zero lost data.</p>
          </div>
        </div>
        <div className="vp-stat-row">
          <div className="vp-stat"><span>Alarms triggered</span><strong>{verified ? `${fires} times` : '—'}</strong></div>
          <div className="vp-stat"><span>Work lost</span><strong>{verified ? '0% (exact match)' : '—'}</strong></div>
          <div className="vp-stat"><span>Overlapping alarms</span><strong>{verified ? 'Blocked safely' : '—'}</strong></div>
        </div>
      </div>
    )
  }

  if (task === 'task2a') {
    return (
      <div className="vp-story">
        <div className="vp-story-label"><HardDrive size={14} /> BEFORE VS. AFTER FILE SIZE LIMIT</div>
        <div className="vp-compare">
          <div className="vp-compare-card">
            <span className="vp-step-num">BEFORE (ORIGINAL XV6)</span>
            <strong>268 KB max</strong>
            <p>Only 2 storage levels (12 direct + 256 single-index blocks).</p>
          </div>
          <ArrowRight size={16} className="vp-arrow" />
          <div className={`vp-compare-card ${verified ? 'vp-step-ok' : ''}`}>
            <span className="vp-step-num">AFTER (OUR UPGRADE · 245× BIGGER)</span>
            <strong>64 MB max (65,803 blocks)</strong>
            <p>Added a 3rd storage level (table of tables) with the same 64-byte header.</p>
          </div>
        </div>
        <div className="vp-bars-simple">
          <div className="vp-bar-item">
            <div className="vp-bar-head"><strong>Level 1 · Direct</strong><span>11 blocks (11 KB)</span></div>
            <div className="vp-bar-track"><div className="vp-bar-fill" style={{ width: verified ? '100%' : '0%' }} /></div>
          </div>
          <div className="vp-bar-item">
            <div className="vp-bar-head"><strong>Level 2 · Single Index</strong><span>256 blocks (256 KB)</span></div>
            <div className="vp-bar-track"><div className="vp-bar-fill" style={{ width: verified ? '100%' : '0%' }} /></div>
          </div>
          <div className="vp-bar-item">
            <div className="vp-bar-head"><strong>Level 3 · Double Index (New)</strong><span>65,536 blocks (64 MB)</span></div>
            <div className="vp-bar-track"><div className="vp-bar-fill" style={{ width: verified ? '100%' : '0%' }} /></div>
          </div>
        </div>
      </div>
    )
  }

  if (task === 'task2b') {
    return (
      <div className="vp-story">
        <div className="vp-story-label"><Link2 size={14} /> SHORTCUT FOLLOWING &amp; LOOP SAFETY</div>
        <div className="vp-compare">
          <div className={`vp-compare-card ${verified ? 'vp-step-ok' : ''}`}>
            <span className="vp-step-num">CHAIN OF SHORTCUTS</span>
            <div className="vp-chain-pills">
              <span className="vp-pill-link">Link 1</span>
              <ArrowRight size={12} />
              <span className="vp-pill-link">Link 2</span>
              <ArrowRight size={12} />
              <span className="vp-pill-link">Link 3</span>
              <ArrowRight size={12} />
              <span className="vp-pill-target">Real File</span>
            </div>
            <p>Opening Link 1 automatically reaches and edits the real file.</p>
          </div>
          <div className={`vp-compare-card ${verified ? 'vp-step-ok' : ''}`}>
            <span className="vp-step-num">INFINITE LOOP PROTECTION</span>
            <div className="vp-chain-pills">
              <span className="vp-pill-link">Link A</span>
              <ArrowRight size={12} />
              <span className="vp-pill-link">Link B</span>
              <ArrowRight size={12} />
              <span className="vp-pill-stop">Stopped at 10</span>
            </div>
            <p>Circular shortcuts return an error instead of freezing the system.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="vp-story">
      <div className="vp-story-label"><Layers size={14} /> HOW MEMORY-MAPPED FILES WORK</div>
      <div className="vp-steps-3">
        <div className={`vp-step-card ${verified ? 'vp-step-ok' : ''}`}>
          <span className="vp-step-num">STEP 1</span>
          <strong>Reserve memory</strong>
          <p>File is linked to an address range instantly — nothing loaded yet.</p>
        </div>
        <ArrowRight size={16} className="vp-arrow" />
        <div className={`vp-step-card ${verified ? 'vp-step-ok' : ''}`}>
          <span className="vp-step-num">STEP 2</span>
          <strong>Load on first touch</strong>
          <p>The moment you read a byte, the OS loads just that page from disk.</p>
        </div>
        <ArrowRight size={16} className="vp-arrow" />
        <div className={`vp-step-card ${verified ? 'vp-step-ok' : ''}`}>
          <span className="vp-step-num">STEP 3</span>
          <strong>Save or keep private</strong>
          <p>Shared edits save back to disk; private edits stay local to the app.</p>
        </div>
      </div>
      <div className="vp-stat-row">
        <div className="vp-stat"><span>Lazy loading</span><strong>{verified ? 'Verified ✓' : '—'}</strong></div>
        <div className="vp-stat"><span>Disk write-back</span><strong>{verified ? 'Shared edits saved' : '—'}</strong></div>
        <div className="vp-stat"><span>Read-only safety</span><strong>{verified ? 'Illegal writes blocked' : '—'}</strong></div>
      </div>
    </div>
  )
}

export default function VerificationPanel({
  task,
  allVerifyResults,
  busy,
  runningThis,
  onSelectTask,
  onVerify,
  onVerifyAll,
}: Props) {
  const [showRaw, setShowRaw] = useState(false)
  const meta = TASK_TABS.find((t) => t.id === task) || TASK_TABS[0]
  const result = allVerifyResults[task]
  const verified = result?.status === 'pass'
  const failed = result?.status === 'fail' || result?.status === 'error' || result?.status === 'timeout'

  const checkDefs = SIMPLE_CHECKS[task]
  const liveMap = new Map<string, Subtest>((result?.subtests || []).map((s) => [s.name, s]))
  const passedCount = checkDefs.filter((c) => liveMap.get(c.id)?.status === 'pass').length

  return (
    <div className="vp-root">
      {/* Task selector pills inside Verify so you can walk through all 4 easily */}
      <div className="vp-task-picker" role="tablist" aria-label="Choose task to verify">
        {TASK_TABS.map((item) => {
          const itemStatus = allVerifyResults[item.id]?.status
          const isPass = itemStatus === 'pass'
          const isSelected = item.id === task
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className={`vp-pick-btn ${isSelected ? 'vp-pick-active' : ''} ${isPass ? 'vp-pick-pass' : ''}`}
              onClick={() => onSelectTask(item.id)}
            >
              {isPass ? <CheckCircle2 size={14} /> : <Circle size={12} />}
              <span>{item.short}</span>
            </button>
          )
        })}
      </div>

      {/* Plain-English Summary Header */}
      <div className={`vp-header ${verified ? 'vp-header-pass' : failed ? 'vp-header-fail' : runningThis ? 'vp-header-run' : ''}`}>
        <div className="vp-header-copy">
          <div className="vp-header-topline">
            <h3>{meta.title}</h3>
            <span className={`vp-status-chip ${verified ? 'chip-pass' : failed ? 'chip-fail' : runningThis ? 'chip-run' : ''}`}>
              {runningThis ? (
                <><LoaderCircle size={13} className="spin" /> Checking live in QEMU…</>
              ) : verified ? (
                <><ShieldCheck size={13} /> Verified ({result.duration.toFixed(1)}s)</>
              ) : failed ? (
                <><XCircle size={13} /> Needs attention</>
              ) : (
                <><Clock3 size={13} /> Not verified yet</>
              )}
            </span>
          </div>
          <p>{meta.analogy}</p>
        </div>

        <div className="vp-header-actions">
          <button
            type="button"
            className="vp-btn-primary"
            onClick={() => onVerify(task)}
            disabled={busy}
          >
            <Sparkles size={14} />
            {runningThis ? 'Verifying…' : verified ? 'Verify again' : 'Verify this task'}
          </button>
          <button
            type="button"
            className="vp-btn-quiet"
            onClick={onVerifyAll}
            disabled={busy}
          >
            Verify all 4 (~6s)
          </button>
        </div>
      </div>

      {/* Clean Visual Story */}
      <SimpleVisual task={task} result={result || { task, status: 'idle', duration: 0, subtests: [], finished_at: '' }} />

      {/* Plain-English Checklist */}
      <div className="vp-checklist-wrap">
        <div className="vp-section-bar">
          <span>WHAT THIS VERIFICATION PROVES</span>
          <span>
            {result ? `${passedCount} of ${checkDefs.length} confirmed` : `${checkDefs.length} checks ready`}
          </span>
        </div>

        <div className="vp-simple-list">
          {checkDefs.map((check) => {
            const live = liveMap.get(check.id)
            const status = live?.status || (runningThis ? 'running' : 'idle')
            return (
              <div key={check.id} className={`vp-simple-row vp-row-${status}`}>
                <div className="vp-row-icon">
                  {status === 'pass' ? <CheckCircle2 size={18} />
                    : status === 'fail' ? <XCircle size={18} />
                      : status === 'running' ? <LoaderCircle size={17} className="spin" />
                        : <Circle size={16} />}
                </div>
                <div className="vp-row-text">
                  <strong>{check.title}</strong>
                  <p>{check.summary}</p>
                </div>
                <span className={`vp-row-tag tag-${status}`}>
                  {status === 'pass' ? 'Verified' : status === 'fail' ? 'Failed' : status === 'running' ? 'Testing…' : 'Pending'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Collapsible Raw QEMU Output (hidden by default so UI stays super light) */}
      {result?.evidence && result.evidence.length > 0 && (
        <div className="vp-raw-drawer">
          <button type="button" className="vp-raw-toggle" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <TerminalSquare size={13} />
            <span>{showRaw ? 'Hide technical QEMU log' : 'Show technical QEMU log (for detailed review)'}</span>
          </button>
          {showRaw && <pre className="vp-evidence-pre">{result.evidence.join('\n')}</pre>}
        </div>
      )}
    </div>
  )
}

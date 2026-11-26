import { useMemo, useState } from 'react'
import { ArrowRight, Check, RotateCcw, Zap } from 'lucide-react'
import type { TaskId } from '../api/types'

const views: Record<TaskId, { title: string; note: string }> = {
  task1: { title: 'An interrupt, handled in user space.', note: 'The kernel snapshots the process registers into a saved trapframe, then redirects execution to the handler. sigreturn restores the original state so the interrupted program continues exactly where it paused.' },
  task2a: { title: 'More address space. Same inode.', note: 'Eleven direct addresses and a single-indirect block are followed by a double-indirect tree. bmap() walks the correct level to locate any logical block.' },
  task2b: { title: 'A path that resolves safely.', note: 'Each symbolic link expands to another path. The resolver follows links up to a depth limit; a loop is detected instead of hanging the kernel.' },
  task3: { title: 'Memory on demand.', note: 'mmap reserves virtual space without reading the file. A page fault allocates just the page being touched; shared dirty pages are written back when unmapped.' },
  usertests: { title: 'Regression keeps the contract honest.', note: 'The full userspace suite checks that the kernel changes preserve existing process, filesystem, and memory behavior.' },
}

function AlarmVisual() {
  const [interval, setInterval] = useState(4)
  const [playing, setPlaying] = useState(true)
  return <div className="visual alarm-visual">
    <div className="visual-head"><span>CPU TICK TIMELINE</span><button onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Resume'}</button></div>
    <div className="tick-track">{Array.from({ length: 12 }, (_, i) => <div className={`tick ${i % interval === interval - 1 ? 'tick-alarm' : ''} ${playing ? 'tick-animate' : ''}`} style={{ animationDelay: `${i * 0.15}s` }} key={i}><span>{i + 1}</span><i /></div>)}</div>
    <div className="alarm-state-grid"><div className="state-chip"><span>PROGRAM</span><strong>work()</strong><small>epc: 0x000018a4</small></div><ArrowRight size={16} className="flow-arrow" /><div className="state-chip state-accent"><span>HANDLER</span><strong>alarm!</strong><small>in_handler = 1</small></div><ArrowRight size={16} className="flow-arrow" /><div className="state-chip"><span>RESTORE</span><strong>sigreturn()</strong><small>trapframe restored</small></div></div>
    <label className="range-control">Alarm every <strong>{interval} ticks</strong><input type="range" min={2} max={8} value={interval} onChange={(event) => setInterval(Number(event.target.value))} /></label>
  </div>
}

function LargeFileVisual() {
  const [block, setBlock] = useState('65802')
  const number = Math.max(0, Math.min(65802, Number(block) || 0))
  const path = number < 11 ? ['inode', `direct[${number}]`] : number < 267 ? ['inode', 'indirect', `entry[${number - 11}]`] : ['inode', 'double indirect', `root[${Math.floor((number - 267) / 256)}]`, `leaf[${(number - 267) % 256}]`]
  const values = [['11', 'Direct blocks'], ['256', 'Single-indirect'], ['65,536', 'Double-indirect']]
  return <div className="visual tree-visual">
    <div className="visual-head"><span>BLOCK ADDRESS WALK</span><span className="mono-note">bmap(uint bn)</span></div>
    <div className="capacity-tree"><div className="tree-node inode-node"><span className="tree-icon">i</span><small>INODE</small></div><div className="tree-branches"><div className="branch"><i /><span>11 direct</span></div><div className="branch"><i /><span>1 × indirect</span></div><div className="branch branch-double"><i /><span>1 × double-indirect</span></div></div><div className="tree-leaves"><span>0—10</span><span>11—266</span><span>267—65,802</span></div></div>
    <div className="capacity-row">{values.map(([num, label]) => <div key={label}><strong>{num}</strong><span>{label}</span></div>)}<div className="capacity-total"><strong>65,803</strong><span>total blocks</span></div></div>
    <div className="block-walk"><label htmlFor="block-input">Logical block number</label><input id="block-input" type="number" min="0" max="65802" value={block} onChange={(event) => setBlock(event.target.value)} /><div className="walk-path">{path.map((part, index) => <span key={part}>{index > 0 && <ArrowRight size={12} />}{part}</span>)}</div></div>
  </div>
}

function SymlinkVisual() {
  const [cycle, setCycle] = useState(false)
  return <div className="visual symlink-visual">
    <div className="visual-head"><span>PATH RESOLUTION</span><button onClick={() => setCycle(!cycle)}>{cycle ? 'Clear cycle' : 'Create a cycle'}</button></div>
    <div className="link-chain"><div className="path-node"><small>REQUEST</small><strong>/docs/start</strong></div><ArrowRight size={16} /><div className="path-node path-link"><small>SYMLINK</small><strong>/docs/start → /data</strong></div><ArrowRight size={16} /><div className={`path-node ${cycle ? 'path-error' : 'path-ok'}`}><small>{cycle ? 'LOOP DETECTED' : 'RESOLVED'}</small><strong>{cycle ? '/data → /docs/start' : '/data/report'}</strong></div></div>
    <div className="depth-meter"><span>Resolution depth</span><div className="depth-pips">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < (cycle ? 10 : 2) ? cycle ? 'pip-error' : 'pip-filled' : ''} />)}</div><strong>{cycle ? '10 / 10 · cycle caught' : '2 / 10'}</strong></div>
  </div>
}

function MmapVisual() {
  const [pages, setPages] = useState([0, 0, 0, 0, 0, 0, 0, 0])
  const [unmapped, setUnmapped] = useState(false)
  const [step, setStep] = useState(0)
  const touch = (index: number) => {
    if (unmapped) return
    setStep(1)
    window.setTimeout(() => setStep(2), 300)
    window.setTimeout(() => { setStep(3); setPages((value) => value.map((page, i) => i === index ? 2 : page)) }, 650)
  }
  const dirtyCount = useMemo(() => pages.filter((page) => page === 2).length, [pages])
  const unmap = () => { setStep(4); window.setTimeout(() => { setPages((value) => value.map(() => 0)); setUnmapped(true) }, 550) }
  return <div className="visual mmap-visual">
    <div className="visual-head"><span>VIRTUAL ADDRESS SPACE</span><button onClick={() => { setPages([0, 0, 0, 0, 0, 0, 0, 0]); setUnmapped(false); setStep(0) }}><RotateCcw size={12} /> Reset</button></div>
    <div className="page-grid">{pages.map((page, i) => <button key={i} className={`page-cell page-${page}`} onClick={() => touch(i)} disabled={unmapped}><span>PAGE {i}</span><strong>{page === 2 ? 'MAPPED' : 'LAZY'}</strong><small>{page === 2 ? '0x0' + (i + 1) + '000' : '—'}</small></button>)}</div>
    <div className="fault-steps">{['page fault', 'kalloc()', 'read file', 'mapped'].map((label, i) => <span className={step >= i + 1 && step < 4 || step === 4 && i < 3 ? 'step-active' : ''} key={label}>{i > 0 && <ArrowRight size={11} />}{label}</span>)}</div>
    <div className="mmap-foot"><span><i className="legend-lazy" /> lazy <i className="legend-mapped" /> mapped · dirty</span><button onClick={unmap} disabled={!dirtyCount || unmapped}>{step === 4 ? 'Writing back…' : `munmap()${dirtyCount ? ` · write back ${dirtyCount}` : ''}`}</button></div>
    {unmapped && <div className="writeback-note"><Check size={12} /> Dirty pages written to file; mapping released.</div>}
  </div>
}

export default function ExplainerPanel({ task }: { task: TaskId }) {
  const copy = views[task]
  return <div className="explainer-panel">
    <div className="explainer-copy"><span className="section-eyebrow">KERNEL CONCEPT · {task.toUpperCase()}</span><h2>{copy.title}</h2><p>{copy.note}</p></div>
    {task === 'task1' ? <AlarmVisual /> : task === 'task2a' ? <LargeFileVisual /> : task === 'task2b' ? <SymlinkVisual /> : <MmapVisual />}
    <div className="concept-footer"><Zap size={13} /><span>Interactive model · simplified for demonstration</span><span className="concept-code">{task === 'task1' ? 'trap.c · sysproc.c' : task === 'task2a' ? 'fs.c · bmap()' : task === 'task2b' ? 'sysfile.c · open()' : 'vm.c · sysfile.c'}</span></div>
  </div>
}

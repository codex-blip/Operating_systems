import { useEffect, useState } from 'react'
import { Command } from 'cmdk'
import { useHotkeys } from '../hooks/useHotkeys'
import { Ban, Eraser, FlaskConical, HardDrive, Layers3, Play, Presentation, RefreshCw, ShieldCheck } from 'lucide-react'
import type { TaskId } from '../api/types'

export type PaletteAction = 'verifyAll' | 'all' | TaskId | 'cancel' | 'clear' | 'demo' | 'rebuild' | 'usertests' | 'bigfiledemo'

const tasks: { id: PaletteAction; label: string; hint: string }[] = [
  { id: 'all', label: 'Run all tasks', hint: 'Task 1 → Task 3' },
  { id: 'task1', label: 'Run Task 1 · Periodic Alarms', hint: 'alarmtest' },
  { id: 'task2a', label: 'Run Task 2A · Large Files', hint: 'bigfile' },
  { id: 'bigfiledemo', label: 'Run quick large-file demo', hint: '512 blocks · bigfiledemo' },
  { id: 'task2b', label: 'Run Task 2B · Symbolic Links', hint: 'symlinktest' },
  { id: 'task3', label: 'Run Task 3 · mmap', hint: 'mmaptest' },
  { id: 'verifyAll', label: 'Verify all tasks (simple visual proof)', hint: '~6s' },
  { id: 'usertests', label: 'Run full usertests', hint: 'long-running' },
  { id: 'rebuild', label: 'Rebuild kernel + filesystem', hint: 'make' },
  { id: 'cancel', label: 'Stop current run', hint: 'cancel' },
  { id: 'clear', label: 'Clear terminal', hint: 'console' },
  { id: 'demo', label: 'Toggle demo mode', hint: 'presentation' },
]
const Icon = ({ action }: { action: PaletteAction }) => action === 'demo' ? <Presentation size={15} /> : action === 'cancel' ? <Ban size={15} /> : action === 'clear' ? <Eraser size={15} /> : action === 'rebuild' ? <RefreshCw size={15} /> : action === 'all' ? <Layers3 size={15} /> : action === 'verifyAll' ? <ShieldCheck size={15} /> : action === 'usertests' ? <FlaskConical size={15} /> : action === 'bigfiledemo' ? <HardDrive size={15} /> : <Play size={15} />

export default function CommandPalette({ onAction }: { onAction: (action: PaletteAction) => void }) {
  const [open, setOpen] = useState(false)
  useHotkeys('k', (event) => { if ((event.metaKey || event.ctrlKey) && !event.shiftKey) { event.preventDefault(); setOpen((value) => !value) } })
  useEffect(() => {
    const listener = () => setOpen(true)
    window.addEventListener('open-command-palette', listener)
    return () => window.removeEventListener('open-command-palette', listener)
  }, [])
  return <>
    {open && <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <Command className="command-palette" label="Command menu">
        <div className="palette-search"><Command.Input autoFocus placeholder="What would you like to do?" /><kbd>ESC</kbd></div>
        <Command.List>
          <Command.Empty>No matching action.</Command.Empty>
          <Command.Group heading="QUICK ACTIONS">
            {tasks.map((item) => <Command.Item key={item.id} onSelect={() => { setOpen(false); onAction(item.id) }}><Icon action={item.id} /><span>{item.label}</span><small>{item.hint}</small></Command.Item>)}
          </Command.Group>
        </Command.List>
        <div className="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>esc</kbd> close</span></div>
      </Command>
    </div>}
  </>
}

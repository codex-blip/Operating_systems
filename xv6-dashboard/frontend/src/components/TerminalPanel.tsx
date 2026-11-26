import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { Copy, CornerDownLeft, Eraser, Maximize2, Minimize2, TerminalSquare } from 'lucide-react'
import type { TaskId } from '../api/types'

type Props = { output: string[]; busy: boolean; onCommand: (command: string) => void; onClear: () => void; selected: TaskId }

const QUICK_COMMANDS = ['verify all', 'alarmtest', 'bigfiledemo', 'symlinktest', 'mmaptest', 'ls']

export default function TerminalPanel({ output, busy, onCommand, onClear, selected }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const priorCount = useRef(0)
  const [command, setCommand] = useState('')
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!container.current) return
    const instance = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"DM Mono", "JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.55,
      scrollback: 2500,
      theme: {
        background: '#101514', foreground: '#dce5e2', cursor: '#83e4d8', selectionBackground: '#24433f',
        black: '#18201f', red: '#ff7d88', green: '#78deb4', yellow: '#e9c47a',
        blue: '#84b9d9', magenta: '#c0a4df', cyan: '#77d9cc', white: '#d6dfde',
      },
    })
    const fitAddon = new FitAddon()
    instance.loadAddon(fitAddon)
    instance.open(container.current)
    fitAddon.fit()
    term.current = instance
    fit.current = fitAddon
    priorCount.current = 0
    instance.writeln('\x1b[38;2;131;228;216m  xv6 kernel lab\x1b[0m  \x1b[90m· live QEMU console\x1b[0m')
    instance.writeln('\x1b[90m  Run any task card above or click a quick command below.\x1b[0m')
    const observer = new ResizeObserver(() => fitAddon.fit())
    observer.observe(container.current)
    return () => { observer.disconnect(); instance.dispose(); term.current = null; priorCount.current = 0 }
  }, [])

  useEffect(() => {
    const instance = term.current
    if (!instance) return
    if (output.length < priorCount.current) {
      priorCount.current = 0
    }
    for (const chunk of output.slice(priorCount.current)) instance.write(chunk)
    priorCount.current = output.length
  }, [output])

  useEffect(() => {
    if (!term.current) return
    const id = window.setTimeout(() => fit.current?.fit(), 30)
    return () => window.clearTimeout(id)
  }, [selected, expanded])

  const run = (textArg?: string) => {
    const text = (textArg ?? command).trim()
    if (!text || busy) return
    if (textArg === undefined) setCommand('')
    onCommand(text)
  }

  const clear = () => {
    priorCount.current = 0
    onClear()
    term.current?.clear()
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output.join(''))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1300)
    } catch { setCopied(false) }
  }

  return (
    <div className={`terminal-panel ${expanded ? 'terminal-expanded' : ''}`}>
      <div className="terminal-toolbar">
        <span className="terminal-title">
          <TerminalSquare size={14} /> xv6 console <i />
        </span>
        <div className="toolbar-actions">
          <button className="tool-button" onClick={copy}>
            <Copy size={13} />{copied ? 'Copied' : 'Copy'}
          </button>
          <button className="tool-button" onClick={clear}>
            <Eraser size={13} />Clear
          </button>
          <button className="tool-button" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? 'Shrink terminal' : 'Expand terminal'}>
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {expanded ? 'Compact' : 'Expand'}
          </button>
        </div>
      </div>

      <div className="xterm-host" ref={container} aria-label="xv6 terminal output" />

      <div className="quick-commands" aria-label="Quick xv6 commands">
        <span>Quick run:</span>
        {QUICK_COMMANDS.map((cmd) => (
          <button key={cmd} type="button" className="quick-chip" disabled={busy} onClick={() => run(cmd)}>
            {cmd}
          </button>
        ))}
      </div>

      <form className="command-form" onSubmit={(event) => { event.preventDefault(); run() }}>
        <span className="command-prompt">xv6 $</span>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          disabled={busy}
          aria-label="xv6 command"
          placeholder={busy ? 'A run is in progress…' : 'Enter any xv6 shell command (e.g. ls, cat README)'}
        />
        <button type="submit" disabled={busy || !command.trim()}>
          <CornerDownLeft size={13} /> Run
        </button>
      </form>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { Copy, CornerDownLeft, Eraser, Maximize2, TerminalSquare } from 'lucide-react'
import type { TaskId } from '../api/types'

type Props = { output: string[]; busy: boolean; onCommand: (command: string) => void; onClear: () => void; selected: TaskId }

export default function TerminalPanel({ output, busy, onCommand, onClear, selected }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const priorCount = useRef(0)
  const [command, setCommand] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!container.current) return
    const instance = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.55,
      scrollback: 2500,
      theme: { background: '#101416', foreground: '#d9e1df', cursor: '#7ce6da', selectionBackground: '#24433f', black: '#18201f', red: '#ff7d88', green: '#78deb4', yellow: '#e9c47a', blue: '#84b9d9', magenta: '#c0a4df', cyan: '#77d9cc', white: '#d6dfde' },
    })
    const fitAddon = new FitAddon()
    instance.loadAddon(fitAddon)
    instance.open(container.current)
    fitAddon.fit()
    term.current = instance
    fit.current = fitAddon
    instance.writeln('\x1b[38;2;124;230;218m  xv6 kernel lab\x1b[0m  \x1b[90m· live test console\x1b[0m')
    instance.writeln('\x1b[90m  Select a test or enter an xv6 command below.\x1b[0m')
    const observer = new ResizeObserver(() => fitAddon.fit())
    observer.observe(container.current)
    return () => { observer.disconnect(); instance.dispose(); term.current = null }
  }, [])

  useEffect(() => {
    const instance = term.current
    if (!instance) return
    for (const chunk of output.slice(priorCount.current)) instance.write(chunk)
    priorCount.current = output.length
  }, [output])

  useEffect(() => { if (term.current) fit.current?.fit() }, [selected])

  const run = () => {
    const text = command.trim()
    if (!text || busy) return
    setCommand('')
    onCommand(text)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output.join(''))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1300)
    } catch { setCopied(false) }
  }

  return <div className="terminal-panel">
    <div className="terminal-toolbar"><span className="terminal-title"><TerminalSquare size={14} /> xv6 console <i /></span><div className="toolbar-actions"><button className="tool-button" onClick={copy}><Copy size={13} />{copied ? 'Copied' : 'Copy'}</button><button className="tool-button" onClick={() => { onClear(); term.current?.clear() }}><Eraser size={13} />Clear</button><span className="term-size"><Maximize2 size={12} /> 12px</span></div></div>
    <div className="xterm-host" ref={container} aria-label="xv6 terminal output" />
    <form className="command-form" onSubmit={(event) => { event.preventDefault(); run() }}>
      <span className="command-prompt">xv6 $</span>
      <input value={command} onChange={(event) => setCommand(event.target.value)} disabled={busy} aria-label="xv6 command" placeholder={busy ? 'A run is in progress…' : 'Try ls, cat README, or any xv6 command'} />
      <button type="submit" disabled={busy || !command.trim()}><CornerDownLeft size={13} /> Run</button>
    </form>
  </div>
}

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Settings2, Wifi, WifiOff } from 'lucide-react'
import type { RuntimeSettings } from '../config'

export default function SettingsPopover({ settings, onSave }: { settings: RuntimeSettings; onSave: (value: RuntimeSettings) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(settings)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [])
  return <div className="settings-wrap" ref={root}>
    <button className="icon-button" onClick={() => { if (!open) { setDraft(settings); setError('') } setOpen((value) => !value) }} aria-expanded={open} aria-label="Open settings"><Settings2 size={17} /><ChevronDown size={12} /></button>
    {open && <div className="settings-popover">
      <div className="popover-heading"><span>Connection settings</span><button className="text-button" onClick={() => setOpen(false)} aria-label="Close settings">×</button></div>
      <label className="setting-row">
        <span><strong>Data source</strong><small>{draft.useMock ? 'Preview without backend' : 'Connect to Flask API'}</small></span>
        <button className={`switch ${draft.useMock ? 'switch-on' : ''}`} role="switch" aria-checked={draft.useMock} onClick={() => setDraft({ ...draft, useMock: !draft.useMock })}><i /></button>
      </label>
      <label className="field-label" htmlFor="api-base">API base URL</label>
      <input id="api-base" className="settings-input" value={draft.apiBase} aria-invalid={Boolean(error)} onChange={(event) => { setDraft({ ...draft, apiBase: event.target.value }); setError('') }} />
      {error && <span className="settings-error">{error}</span>}
      <div className="setting-row compact">
        <span><strong>Demo a failure</strong><small>Show an assertion failure</small></span>
        <button className={`switch ${draft.simulateFailure ? 'switch-on' : ''}`} role="switch" aria-checked={draft.simulateFailure} onClick={() => setDraft({ ...draft, simulateFailure: !draft.simulateFailure })}><i /></button>
      </div>
      <div className="setting-row compact">
        <span><strong>Simulate offline</strong><small>Preview reconnect state</small></span>
        <button className={`switch ${draft.simulateOffline ? 'switch-on' : ''}`} role="switch" aria-checked={draft.simulateOffline} onClick={() => setDraft({ ...draft, simulateOffline: !draft.simulateOffline })}><i /></button>
      </div>
      <button className="save-settings" onClick={() => {
        const apiBase = draft.apiBase.trim().replace(/\/+$/, '')
        try {
          const url = new URL(apiBase)
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol')
          onSave({ ...draft, apiBase })
          setOpen(false)
        } catch {
          setError('Enter a valid http:// or https:// API base URL.')
        }
      }}><Check size={14} /> Save settings</button>
      <div className="settings-foot"><span>{draft.useMock ? <WifiOff size={13} /> : <Wifi size={13} />}{draft.useMock ? 'Mock mode' : 'Live mode'}</span><span>Saved on this device</span></div>
    </div>}
  </div>
}

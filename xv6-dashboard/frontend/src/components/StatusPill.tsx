import type { TaskStatus } from '../api/types'
import { CircleDot, CircleCheck, CircleX, LoaderCircle, Minus } from 'lucide-react'

const style: Record<string, { label: string; icon: typeof CircleDot }> = {
  idle: { label: 'Idle', icon: Minus },
  running: { label: 'Running', icon: LoaderCircle },
  pass: { label: 'Passed', icon: CircleCheck },
  fail: { label: 'Failed', icon: CircleX },
  timeout: { label: 'Timeout', icon: CircleX },
  error: { label: 'Error', icon: CircleX },
  cancelled: { label: 'Cancelled', icon: CircleDot },
  building: { label: 'Building', icon: LoaderCircle },
  offline: { label: 'Offline', icon: CircleX },
}

export default function StatusPill({ status }: { status: TaskStatus | 'building' | 'offline' }) {
  const current = style[status] || style.idle
  const Icon = current.icon
  return <span className={`status-pill status-${status}`}><Icon size={13} strokeWidth={2.2} /><span>{current.label}</span></span>
}

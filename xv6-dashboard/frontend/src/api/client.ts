import { fetchEventSource } from '@microsoft/fetch-event-source'
import type { RuntimeSettings } from '../config'
import { MockClient } from './mockClient'
import type { ApiEventHandler, DashboardClient, DiffResponse, Health, HistoryItem, StreamRequest, Task, TaskId, BackendStatus, StreamEvent } from './types'

export function makeClient(settings: RuntimeSettings): DashboardClient {
  if (settings.useMock) return new MockClient(settings)
  const base = settings.apiBase.replace(/\/+$/, '')
  const json = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${base}${path}`, init)
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string; message?: string; current_task?: string }
      const error = new Error(data.message || data.error || `Request failed (${response.status})`)
      Object.assign(error, { status: response.status, data })
      throw error
    }
    return response.json() as Promise<T>
  }
  const paths = {
    health: '/health',
    tasks: '/tasks',
    status: '/status',
    history: '/history',
  }
  return {
    health: () => json<Health>(paths.health),
    tasks: () => json<Task[]>(paths.tasks),
    status: () => json<BackendStatus>(paths.status),
    history: () => json<HistoryItem[]>(paths.history),
    diff: (task: TaskId) => json<DiffResponse>(`/diff/${task}`),
    cancel: () => json<{ ok: boolean; cancelled: boolean }>('/cancel', { method: 'POST' }),
    stream: async (request: StreamRequest, onEvent: ApiEventHandler, signal: AbortSignal) => {
      const endpoint = request.kind === 'run' ? `/run/${request.task}`
        : request.kind === 'runAll' ? '/run-all'
          : request.kind === 'rebuild' ? '/rebuild' : '/command'
      const body = request.kind === 'command' ? { command: request.command }
        : request.kind === 'rebuild' ? { clean: request.clean } : {}
      let terminal = false
      await fetchEventSource(`${base}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal,
        openWhenHidden: true,
        async onopen(response) {
          if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) return
          const data = await response.json().catch(() => ({})) as { error?: string; message?: string; current_task?: string }
          if (response.status === 409) {
            onEvent({ type: 'error', code: 'busy', message: `Busy${data.current_task ? ` running ${data.current_task}` : ''}.` })
            terminal = true
            return
          }
          throw new Error(data.message || data.error || `Request failed (${response.status})`)
        },
        onmessage(message) {
          if (!message.data) return
          const event = JSON.parse(message.data) as StreamEvent
          onEvent(event)
          if (event.type === 'finished' || event.type === 'all_finished' || event.type === 'error') terminal = true
        },
        onclose() {
          if (!terminal && !signal.aborted) throw new Error('The event stream closed before a completion event.')
        },
        onerror(error) {
          throw error
        },
      })
    },
  }
}

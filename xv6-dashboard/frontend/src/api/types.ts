export type TaskId = 'task1' | 'task2a' | 'task2b' | 'task3' | 'usertests'
export type TaskStatus = 'idle' | 'running' | 'pass' | 'fail' | 'timeout' | 'cancelled' | 'error'
export type Subtest = { name: string; status: 'pass' | 'fail' | 'running'; detail: string }
export type Result = {
  task: string
  status: TaskStatus
  duration: number
  subtests: Subtest[]
  finished_at: string
}
export type Task = {
  id: TaskId
  name: string
  description: string
  command: string
  est_seconds: number
}
export type HistoryItem = {
  run_id: string
  task: string
  status: TaskStatus
  duration: number
  started_at: string
  passed: number
  total: number
}
export type Health = { status: string; qemu: 'idle' | 'running'; xv6_path: string }
export type BackendStatus = {
  state: 'idle' | 'building' | 'running'
  current_task: string | null
  run_id: string | null
  last_results: Record<string, Result>
}
export type DiffResponse = { task: string; commits: { hash: string; subject: string }[]; diff: string }

export type StreamEvent =
  | { type: 'started'; run_id: string; task: string; command: string; ts: string }
  | { type: 'build'; line: string }
  | { type: 'output'; data: string }
  | { type: 'subtest'; name: string; status: Subtest['status']; detail: string }
  | { type: 'task_started'; task: string }
  | { type: 'task_finished'; task: string; status: TaskStatus; duration: number; result: Result }
  | { type: 'finished'; run_id: string; task: string; result: Result }
  | { type: 'all_finished'; results: Record<string, Result> }
  | { type: 'error'; code: string; message: string }

export type StreamRequest =
  | { kind: 'run'; task: TaskId }
  | { kind: 'runAll' }
  | { kind: 'command'; command: string }
  | { kind: 'rebuild'; clean: boolean }

export type ApiEventHandler = (event: StreamEvent) => void

export interface DashboardClient {
  health(): Promise<Health>
  tasks(): Promise<Task[]>
  status(): Promise<BackendStatus>
  history(): Promise<HistoryItem[]>
  diff(task: TaskId): Promise<DiffResponse>
  stream(request: StreamRequest, onEvent: ApiEventHandler, signal: AbortSignal): Promise<void>
  cancel(): Promise<{ ok: boolean; cancelled: boolean }>
}

import type {
  ApiEventHandler,
  BackendStatus,
  DashboardClient,
  DiffResponse,
  Health,
  HistoryItem,
  Result,
  StreamEvent,
  StreamRequest,
  Task,
  TaskId,
} from './types'

const taskList: Task[] = [
  { id: 'task1', name: 'Periodic Alarms', description: 'User-level timer interrupts with sigalarm and sigreturn.', command: 'alarmtest', est_seconds: 20 },
  { id: 'task2a', name: 'Large Files', description: 'Double-indirect blocks expand xv6 file capacity.', command: 'bigfile', est_seconds: 180 },
  { id: 'task2b', name: 'Symbolic Links', description: 'Path resolution follows links safely, even under concurrency.', command: 'symlinktest', est_seconds: 20 },
  { id: 'task3', name: 'Memory-Mapped Files', description: 'Lazy file-backed pages, shared writeback, and fork support.', command: 'mmaptest', est_seconds: 40 },
  { id: 'usertests', name: 'Full Regression Suite', description: 'The complete xv6 userspace regression suite.', command: 'usertests', est_seconds: 600 },
]

const testNames: Record<TaskId, string[]> = {
  task1: ['test0', 'test1', 'test2', 'test3'],
  task2a: ['large file write', 'large file read', 'maximum file size'],
  task2b: ['test symlinks', 'test concurrent symlinks'],
  task3: ['test basic mmap', 'test mmap private', 'test mmap read-only', 'test mmap read/write', 'test mmap dirty', 'test lazy access', 'test mmap two files', 'test fork'],
  usertests: ['usertests'],
}

const snippets: Record<TaskId, string[]> = {
  task1: ['test0 start', '........................................alarm!', 'test0 passed', 'test1 start', '....alarm!....alarm!....alarm!', 'test1 passed', 'test2 start', '................................alarm!', 'test2 passed', 'test3 start', 'test3 passed'],
  task2a: ['bigfile starting', 'writing blocks: .......... .......... ..........', 'wrote 65803 blocks', 'reading blocks: .......... ..........', 'bigfile done; ok'],
  task2b: ['Start: test symlinks', 'test symlinks: ok', 'Start: test concurrent symlinks', 'test concurrent symlinks: ok'],
  task3: ['mmaptest starting', 'test mmap f: OK', 'test mmap private: OK', 'test mmap read-only: OK', 'test mmap read/write: OK', 'test mmap dirty: OK', 'test not-mapped unmap: OK', 'test mmap two files: OK', 'fork_test starting', 'fork_test OK', 'mmaptest: all tests succeeded'],
  usertests: ['usertests starting', 'usertests: regression checks passed'],
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
  const timer = window.setTimeout(resolve, ms)
  signal.addEventListener('abort', () => {
    window.clearTimeout(timer)
    reject(new DOMException('Aborted', 'AbortError'))
  }, { once: true })
})

let active = false
let activeTask: string | null = null
let cancelActive: (() => void) | null = null
const results: Record<string, Result> = {}
const historyRows: HistoryItem[] = []

function mkResult(task: string, status: Result['status'], subtests: Result['subtests'], duration: number): Result {
  return { task, status, subtests, duration, finished_at: new Date().toISOString() }
}

export class MockClient implements DashboardClient {
  private readonly settings: { simulateFailure: boolean; simulateOffline: boolean }
  constructor(settings: { simulateFailure: boolean; simulateOffline: boolean }) {
    this.settings = settings
  }

  private online() {
    if (this.settings.simulateOffline) throw new Error('mock-offline')
  }

  async health(): Promise<Health> {
    this.online()
    return { status: 'ok', qemu: active ? 'running' : 'idle', xv6_path: '~/xv6 (mock)' }
  }
  async tasks() { this.online(); return taskList }
  async status(): Promise<BackendStatus> {
    this.online()
    return { state: active ? 'running' : 'idle', current_task: activeTask, run_id: active ? 'mock-session' : null, last_results: { ...results } }
  }
  async history() { this.online(); return [...historyRows] }
  async diff(task: TaskId): Promise<DiffResponse> {
    this.online()
    return {
      task,
      commits: [{ hash: 'mock1a2b', subject: `Implement ${task} kernel changes` }],
      diff: `diff --git a/kernel/${task}.c b/kernel/${task}.c\nindex 28ac1f2..ab92d20 100644\n--- a/kernel/${task}.c\n+++ b/kernel/${task}.c\n@@ -18,6 +18,12 @@\n+// ${task} implementation\n+static int project_change(void) {\n+  return 0;\n+}\n`,
    }
  }

  async cancel() {
    const cancelled = active
    cancelActive?.()
    return { ok: true, cancelled }
  }

  async stream(request: StreamRequest, onEvent: ApiEventHandler, signal: AbortSignal) {
    this.online()
    if (active) {
      onEvent({ type: 'error', code: 'busy', message: `Another run is active (${activeTask ?? 'unknown task'}).` })
      return
    }
    active = true
    activeTask = request.kind === 'run' ? request.task : request.kind === 'runAll' ? 'run-all' : request.kind
    let cancel!: () => void
    const cancelled = new Promise<void>((resolve) => { cancel = resolve })
    cancelActive = cancel
    const tasks = request.kind === 'runAll' ? ['task1', 'task2a', 'task2b', 'task3'] as TaskId[] : request.kind === 'run' ? [request.task] : []
    const streamTask = async (task: TaskId) => {
      const meta = taskList.find((entry) => entry.id === task)!
      const runId = `mock-${Date.now().toString(36)}`
      onEvent({ type: 'started', run_id: runId, task, command: meta.command, ts: new Date().toISOString() })
      onEvent({ type: 'output', data: '\r\n\x1b[38;2;99;222;213mxv6 kernel is booting\x1b[0m\r\nhart 1 starting\r\nhart 2 starting\r\ninit: starting sh\r\n$ ' })
      await sleep(350, signal)
      onEvent({ type: 'output', data: `${meta.command}\r\n` })
      const lines = snippets[task]
      const names = testNames[task]
      const subtests: Result['subtests'] = []
      for (let i = 0; i < lines.length; i++) {
        await Promise.race([sleep(task === 'task2a' ? 2400 : 280, signal), cancelled])
        if (signal.aborted) return null
        onEvent({ type: 'output', data: `${lines[i]}\r\n` })
        const name = names.find((candidate) => lines[i].toLowerCase().includes(candidate.toLowerCase()) && /passed|: ok|ok$/.test(lines[i].toLowerCase()))
        if (name) {
          const failed = this.settings.simulateFailure && i === lines.length - 1
          const subtest = { name, status: failed ? 'fail' as const : 'pass' as const, detail: failed ? 'Simulated assertion failure.' : '' }
          subtests.push(subtest)
          onEvent({ type: 'subtest', ...subtest })
        }
      }
      for (const name of names) {
        if (!subtests.some((entry) => entry.name === name)) {
          const failed = this.settings.simulateFailure && name === names[names.length - 1]
          const subtest = { name, status: failed ? 'fail' as const : 'pass' as const, detail: failed ? 'Simulated assertion failure.' : '' }
          subtests.push(subtest)
          onEvent({ type: 'subtest', ...subtest })
        }
      }
      const fail = this.settings.simulateFailure
      const result = mkResult(task, fail ? 'fail' : 'pass', subtests.map((entry) => ({ ...entry, status: fail && entry.name === names[names.length - 1] ? 'fail' : 'pass' })), lines.length * 0.28)
      results[task] = result
      historyRows.unshift({ run_id: runId, task, status: result.status, duration: result.duration, started_at: result.finished_at, passed: result.subtests.filter((entry) => entry.status === 'pass').length, total: result.subtests.length })
      return result
    }

    try {
      if (request.kind === 'rebuild') {
        onEvent({ type: 'started', run_id: 'mock-build', task: 'rebuild', command: request.clean ? 'make clean && make -j8 kernel/kernel fs.img' : 'make -j8 kernel/kernel fs.img', ts: new Date().toISOString() })
        onEvent({ type: 'build', line: '$ make -j8 kernel/kernel fs.img' })
        await sleep(500, signal)
        onEvent({ type: 'build', line: 'riscv64-unknown-elf-gcc ... kernel/kernel' })
        await sleep(350, signal)
        onEvent({ type: 'build', line: 'mkfs/mkfs fs.img ...' })
        onEvent({ type: 'finished', run_id: 'mock-build', task: 'rebuild', result: mkResult('rebuild', 'pass', [], 0.9) })
      } else if (request.kind === 'command') {
        onEvent({ type: 'started', run_id: 'mock-command', task: 'command', command: request.command, ts: new Date().toISOString() })
        onEvent({ type: 'output', data: '\r\nxv6 kernel is booting\r\ninit: starting sh\r\n$ ' })
        await sleep(400, signal)
        onEvent({ type: 'output', data: `${request.command}\r\n` })
        if (request.command === 'bigfiledemo') {
          onEvent({ type: 'output', data: 'bigfiledemo: writing 512 blocks\r\n' })
          for (let blocks = 64; blocks <= 512; blocks += 64) {
            await sleep(180, signal)
            onEvent({ type: 'output', data: `wrote ${blocks} / 512 blocks\r\n` })
          }
          onEvent({ type: 'output', data: 'bigfiledemo: reading and verifying blocks\r\n' })
          await sleep(350, signal)
          onEvent({ type: 'output', data: 'bigfiledemo: PASS (512 blocks; double-indirect mapping verified)\r\n$ ' })
          onEvent({ type: 'finished', run_id: 'mock-command', task: 'command', result: mkResult('command', 'pass', [], 2.2) })
        } else {
          await sleep(250, signal)
          onEvent({ type: 'output', data: request.command === 'ls' ? '.  ..  README  bigfile  bigfiledemo  mmaptest  symlinktest\r\n$ ' : `${request.command}: command completed\r\n$ ` })
          onEvent({ type: 'finished', run_id: 'mock-command', task: 'command', result: mkResult('command', 'pass', [], 0.7) })
        }
      } else if (request.kind === 'runAll') {
        const runId = `mock-all-${Date.now().toString(36)}`
        onEvent({ type: 'started', run_id: runId, task: 'all', command: tasks.map((id) => taskList.find((task) => task.id === id)?.command).join(' ; '), ts: new Date().toISOString() })
        const all: Record<string, Result> = {}
        for (const task of tasks) {
          if (signal.aborted) break
          activeTask = task
          onEvent({ type: 'task_started', task })
          const result = await streamTask(task)
          if (!result) break
          all[task] = result
          onEvent({ type: 'task_finished', task, status: result.status, duration: result.duration, result })
        }
        onEvent({ type: 'all_finished', results: all })
      } else {
        const result = await streamTask(request.task)
        if (result) onEvent({ type: 'finished', run_id: `mock-${request.task}`, task: request.task, result })
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
    } finally {
      active = false
      activeTask = null
      cancelActive = null
    }
  }
}

export function createDefaultResult(task: TaskId): Result {
  return mkResult(task, 'idle', [], 0)
}

export function isStreamEvent(event: StreamEvent): boolean {
  return event.type === 'finished' || event.type === 'all_finished'
}

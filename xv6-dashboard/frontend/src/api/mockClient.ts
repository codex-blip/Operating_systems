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
  { id: 'task1', name: 'Periodic Alarms', description: 'User-level timer interrupts with sigalarm and sigreturn.', command: 'alarmtest', est_seconds: 5 },
  { id: 'task2a', name: 'Large Files', description: 'Doubly-indirect blocks expand xv6 capacity to 65,803 blocks.', command: 'bigfile', est_seconds: 215 },
  { id: 'task2b', name: 'Symbolic Links', description: 'Path resolution follows links safely with cycle protection.', command: 'symlinktest', est_seconds: 8 },
  { id: 'task3', name: 'Memory-Mapped Files', description: 'Lazy file-backed pages, shared writeback, and fork support.', command: 'mmaptest', est_seconds: 5 },
  { id: 'usertests', name: 'Full Regression Suite', description: 'The complete xv6 userspace regression suite.', command: 'usertests', est_seconds: 600 },
]

const verifyMockData: Record<Exclude<TaskId, 'usertests'>, {
  checks: { name: string; detail: string; raw: string }[]
  metrics: Record<string, string | number>
}> = {
  task1: {
    checks: [
      { name: 'periodic_registers', detail: 'calls=6 iterations=68289108 reg_match=100%', raw: 'VERIFY_CHECK periodic_registers PASS calls=6 iterations=68289108 reg_match=100%' },
      { name: 'non_reentrant', detail: 'nested_calls=0 disabled_after_zero=yes', raw: 'VERIFY_CHECK non_reentrant PASS nested_calls=0 disabled_after_zero=yes' },
      { name: 'a0_restore', detail: 'saved_a0=0xac restored_a0=0xAC', raw: 'VERIFY_CHECK a0_restore PASS saved_a0=0xac restored_a0=0xAC' },
      { name: 'exec_reset', detail: 'child_exit=0 stale_handler_cleared=yes', raw: 'VERIFY_CHECK exec_reset PASS child_exit=0 stale_handler_cleared=yes' },
    ],
    metrics: { handler_fires: 7, a0_hex: '0xac', dinode_regs: 31 },
  },
  task2a: {
    checks: [
      { name: 'direct_blocks', detail: 'blocks=0..10 count=11 bytes=11264', raw: 'VERIFY_CHECK direct_blocks PASS blocks=0..10 count=11 bytes=11264' },
      { name: 'single_indirect', detail: 'blocks=11..266 count=256 bytes=262144', raw: 'VERIFY_CHECK single_indirect PASS blocks=11..266 count=256 bytes=262144' },
      { name: 'double_indirect', detail: 'blocks=267..529 count=263 l1_spans=2 bytes=269312', raw: 'VERIFY_CHECK double_indirect PASS blocks=267..529 count=263 l1_spans=2 bytes=269312' },
      { name: 'read_verify', detail: 'verified_blocks=530 total_bytes=542720', raw: 'VERIFY_CHECK read_verify PASS verified_blocks=530 total_bytes=542720' },
      { name: 'itrunc_cleanup', detail: 'truncated_to=0 freed_tiers=3 dinode_bytes=64', raw: 'VERIFY_CHECK itrunc_cleanup PASS truncated_to=0 freed_tiers=3 dinode_bytes=64' },
    ],
    metrics: { direct_blocks: 11, single_blocks: 256, double_blocks: 263, max_capacity: 65803, dinode_size: 64 },
  },
  task2b: {
    checks: [
      { name: 'chain_follow', detail: 'hops=3 payload=SYMLINK_DATA_OK', raw: 'VERIFY_CHECK chain_follow PASS hops=3 payload=SYMLINK_DATA_OK' },
      { name: 'nofollow_stat', detail: 'link_type=T_SYMLINK(4) link_size=7 dir_nofollow=ok', raw: 'VERIFY_CHECK nofollow_stat PASS link_type=T_SYMLINK(4) link_size=7 dir_nofollow=ok' },
      { name: 'cycle_guard', detail: 'max_depth=10 cycle_ret=-1 dangling_ret=-1', raw: 'VERIFY_CHECK cycle_guard PASS max_depth=10 cycle_ret=-1 dangling_ret=-1' },
      { name: 'concurrent_ops', detail: 'workers=2 iterations=80 races=0', raw: 'VERIFY_CHECK concurrent_ops PASS workers=2 iterations=80 races=0' },
    ],
    metrics: { chain_hops: 3, depth_cap: 10, concurrent_ops: 80 },
  },
  task3: {
    checks: [
      { name: 'lazy_fault', detail: 'mapped_va=0x0000003FFFFFB000 post_mmap_disk_byte=L tail_zero_fill=yes', raw: 'VERIFY_CHECK lazy_fault PASS mapped_va=0x0000003FFFFFB000 post_mmap_disk_byte=L tail_zero_fill=yes' },
      { name: 'shared_writeback', detail: 'map_private_isolated=yes map_shared_persisted=S,W partial_munmap=ok', raw: 'VERIFY_CHECK shared_writeback PASS map_private_isolated=yes map_shared_persisted=S,W partial_munmap=ok' },
      { name: 'copyout_va_reuse', detail: 'reclaimed_va=0x0000003FFFFFC000 copyout_pte_d=persisted len_120_aligned=4096', raw: 'VERIFY_CHECK copyout_va_reuse PASS reclaimed_va=0x0000003FFFFFC000 copyout_pte_d=persisted len_120_aligned=4096' },
      { name: 'fork_protection', detail: 'child_read_shared=ok ro_write_killed=-1', raw: 'VERIFY_CHECK fork_protection PASS child_read_shared=ok ro_write_killed=-1' },
    ],
    metrics: { mapped_va: '0x0000003FFFFFC000', pages_tested: 6, writeback_bytes: 6144 },
  },
}

const testNames: Record<TaskId, string[]> = {
  task1: ['test0', 'test1', 'test2', 'test3'],
  task2a: ['write', 'read'],
  task2b: ['symlinks', 'concurrent symlinks'],
  task3: ['basic mmap', 'mmap private', 'mmap read-only', 'mmap read/write', 'mmap dirty', 'not-mapped unmap', 'lazy access', 'mmap two files', 'fork', 'munmap prevents access', 'writes to read-only mapped memory'],
  usertests: ['usertests'],
}

const snippets: Record<TaskId, string[]> = {
  task1: ['test0 start', '........................................alarm!', 'test0 passed', 'test1 start', '....alarm!....alarm!....alarm!', 'test1 passed', 'test2 start', '................................alarm!', 'test2 passed', 'test3 start', 'test3 passed'],
  task2a: ['bigfile starting', 'writing blocks: .......... .......... ..........', 'wrote 65803 blocks', 'reading bigfile', 'bigfile done; ok'],
  task2b: ['Start: test symlinks', 'test symlinks: ok', 'Start: test concurrent symlinks', 'test concurrent symlinks: ok'],
  task3: ['test basic mmap: OK', 'test mmap private: OK', 'test mmap read-only: OK', 'test mmap read/write: OK', 'test mmap dirty: OK', 'test not-mapped unmap: OK', 'test lazy access: OK', 'test mmap two files: OK', 'test fork: OK', 'test munmap prevents access: OK', 'test writes to read-only mapped memory: OK', 'mmaptest: all tests succeeded'],
  usertests: ['usertests starting', 'ALL TESTS PASSED'],
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

function mkResult(task: string, status: Result['status'], subtests: Result['subtests'], duration: number, extra?: Partial<Result>): Result {
  return { task, status, subtests, duration, finished_at: new Date().toISOString(), ...extra }
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
      commits: [{ hash: 'dc181c3', subject: `Implement ${task} kernel changes and edge-case fixes` }],
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
    activeTask = request.kind === 'run' || request.kind === 'verify' ? request.task : request.kind
    let cancel!: () => void
    const cancelled = new Promise<void>((resolve) => { cancel = resolve })
    cancelActive = cancel

    const streamVerify = async (task: Exclude<TaskId, 'usertests'>) => {
      const spec = verifyMockData[task]
      const runId = `mock-v-${Date.now().toString(36)}`
      onEvent({ type: 'started', run_id: runId, task, command: `verify ${task}`, ts: new Date().toISOString() })
      onEvent({ type: 'output', data: `\r\n$ verify ${task}\r\nVERIFY_START ${task}\r\n` })
      const subtests: Result['subtests'] = []
      const evidence = [`VERIFY_START ${task}`]
      for (let i = 0; i < spec.checks.length; i++) {
        await Promise.race([sleep(220, signal), cancelled])
        if (signal.aborted) return null
        const c = spec.checks[i]
        const failed = this.settings.simulateFailure && i === spec.checks.length - 1
        const st = { name: c.name, status: failed ? 'fail' as const : 'pass' as const, detail: failed ? 'Simulated check failure' : c.detail }
        subtests.push(st)
        evidence.push(c.raw)
        onEvent({ type: 'output', data: `${c.raw}\r\n` })
        onEvent({ type: 'subtest', ...st })
      }
      evidence.push(`VERIFY_DONE ${task} PASS`)
      onEvent({ type: 'output', data: `VERIFY_DONE ${task} PASS\r\n$ ` })
      const result = mkResult(task, this.settings.simulateFailure ? 'fail' : 'pass', subtests, 1.4, {
        metrics: spec.metrics,
        evidence,
        mode: 'verify',
      })
      results[task] = result
      historyRows.unshift({ run_id: runId, task, status: result.status, duration: result.duration, started_at: result.finished_at, passed: subtests.filter((s) => s.status === 'pass').length, total: subtests.length })
      return result
    }

    const streamTask = async (task: TaskId) => {
      const meta = taskList.find((entry) => entry.id === task)!
      const runId = `mock-${Date.now().toString(36)}`
      onEvent({ type: 'started', run_id: runId, task, command: meta.command, ts: new Date().toISOString() })
      onEvent({ type: 'output', data: '\r\n\x1b[38;2;99;222;213mxv6 kernel is booting\x1b[0m\r\nhart 1 starting\r\nhart 2 starting\r\ninit: starting sh\r\n$ ' })
      await sleep(300, signal)
      onEvent({ type: 'output', data: `${meta.command}\r\n` })
      const lines = snippets[task]
      const names = testNames[task]
      const subtests: Result['subtests'] = []
      for (let i = 0; i < lines.length; i++) {
        await Promise.race([sleep(task === 'task2a' ? 600 : 220, signal), cancelled])
        if (signal.aborted) return null
        onEvent({ type: 'output', data: `${lines[i]}\r\n` })
      }
      for (const name of names) {
        const failed = this.settings.simulateFailure && name === names[names.length - 1]
        const subtest = { name, status: failed ? 'fail' as const : 'pass' as const, detail: failed ? 'Simulated assertion failure.' : 'verified in mock run' }
        subtests.push(subtest)
        onEvent({ type: 'subtest', ...subtest })
      }
      const fail = this.settings.simulateFailure
      const result = mkResult(task, fail ? 'fail' : 'pass', subtests, lines.length * 0.25, { evidence: lines, mode: 'suite' })
      results[task] = result
      historyRows.unshift({ run_id: runId, task, status: result.status, duration: result.duration, started_at: result.finished_at, passed: result.subtests.filter((entry) => entry.status === 'pass').length, total: result.subtests.length })
      return result
    }

    try {
      if (request.kind === 'rebuild') {
        onEvent({ type: 'started', run_id: 'mock-build', task: 'rebuild', command: request.clean ? 'make clean && make -j8 kernel/kernel fs.img' : 'make -j8 kernel/kernel fs.img', ts: new Date().toISOString() })
        onEvent({ type: 'build', line: '$ make -j8 kernel/kernel fs.img' })
        await sleep(450, signal)
        onEvent({ type: 'build', line: 'mkfs/mkfs fs.img ...' })
        onEvent({ type: 'finished', run_id: 'mock-build', task: 'rebuild', result: mkResult('rebuild', 'pass', [], 0.8) })
      } else if (request.kind === 'verify' && request.task !== 'usertests') {
        const result = await streamVerify(request.task)
        if (result) onEvent({ type: 'finished', run_id: `mock-v-${request.task}`, task: request.task, result })
      } else if (request.kind === 'verifyAll') {
        const order: Exclude<TaskId, 'usertests'>[] = ['task1', 'task2a', 'task2b', 'task3']
        onEvent({ type: 'started', run_id: 'mock-verify-all', task: 'all', command: 'verify task1..task3', ts: new Date().toISOString() })
        const all: Record<string, Result> = {}
        for (const task of order) {
          if (signal.aborted) break
          activeTask = task
          onEvent({ type: 'task_started', task })
          const result = await streamVerify(task)
          if (!result) break
          all[task] = result
          onEvent({ type: 'task_finished', task, status: result.status, duration: result.duration, result })
        }
        onEvent({ type: 'all_finished', results: all })
      } else if (request.kind === 'command') {
        onEvent({ type: 'started', run_id: 'mock-command', task: 'command', command: request.command, ts: new Date().toISOString() })
        onEvent({ type: 'output', data: `\r\n$ ${request.command}\r\n` })
        await sleep(300, signal)
        onEvent({ type: 'output', data: `${request.command}: completed\r\n$ ` })
        onEvent({ type: 'finished', run_id: 'mock-command', task: 'command', result: mkResult('command', 'pass', [], 0.6) })
      } else if (request.kind === 'runAll') {
        const order: TaskId[] = ['task1', 'task2a', 'task2b', 'task3']
        const all: Record<string, Result> = {}
        for (const task of order) {
          if (signal.aborted) break
          activeTask = task
          onEvent({ type: 'task_started', task })
          const result = await streamTask(task)
          if (!result) break
          all[task] = result
          onEvent({ type: 'task_finished', task, status: result.status, duration: result.duration, result })
        }
        onEvent({ type: 'all_finished', results: all })
      } else if (request.kind === 'run') {
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

import { useEffect, useState } from 'react'
import { GitCommitHorizontal, LoaderCircle } from 'lucide-react'
import type { DashboardClient, DiffResponse, TaskId } from '../api/types'

export default function DiffPanel({ task, client }: { task: TaskId; client: DashboardClient }) {
  const [diff, setDiff] = useState<DiffResponse | null>(null)
  const [error, setError] = useState('')
  const [loadedTask, setLoadedTask] = useState<TaskId | null>(null)
  const loading = loadedTask !== task
  useEffect(() => {
    let alive = true
    client.diff(task).then((value) => { if (alive) { setDiff(value); setError(''); setLoadedTask(task) } })
      .catch((reason: Error) => { if (alive) { setError(reason.message); setLoadedTask(task) } })
    return () => { alive = false }
  }, [task, client])
  if (loading) return <div className="panel-loading"><LoaderCircle className="spin" size={18} /> Loading commit diff…</div>
  if (error) return <div className="empty-state"><GitCommitHorizontal size={24} /><strong>Diff unavailable</strong><span>{error}</span></div>
  const lines = (diff?.diff || '').split('\n')
  return <div className="diff-panel">
    <div className="diff-meta"><div><GitCommitHorizontal size={15} /><strong>{diff?.commits.length ? `${diff.commits.length} project commit${diff.commits.length === 1 ? '' : 's'}` : 'Working tree changes'}</strong></div><span>{task} · unified diff</span></div>
    {diff?.commits.length ? <div className="commit-list">{diff.commits.map((commit) => <div className="commit-row" key={commit.hash}><code>{commit.hash}</code><span>{commit.subject}</span></div>)}</div> : null}
    {diff?.diff ? <pre className="diff-code">{lines.map((line, index) => <span key={`${index}-${line}`} className={line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-remove' : line.startsWith('@@') ? 'diff-hunk' : line.startsWith('diff ') || line.startsWith('index ') ? 'diff-file' : ''}>{line || ' '}{'\n'}</span>)}</pre>
      : <div className="empty-state diff-empty"><GitCommitHorizontal size={25} /><strong>No diff found for {task}</strong><span>When this task has a saved implementation commit, its patch appears here.</span></div>}
  </div>
}

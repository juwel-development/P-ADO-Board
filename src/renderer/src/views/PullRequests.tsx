import { useMemo, useState } from 'react'
import { ArrowRight, ArrowUpRight, Check, Clock, FolderGit2, GitPullRequest, RefreshCw, Search, X } from 'lucide-react'
import { pullRequestWebUrl, repoPullsWebUrl, type PullRequest } from '@/lib/api'
import { branchName } from '@/lib/pulls'
import { useMe, usePullRequests } from '@/lib/queries'
import { useUi } from '@/lib/store'
import { cn, relativeTime } from '@/lib/utils'
import { useWatch } from '@/lib/watch'
import { Avatar, Button, EmptyState, ErrorState, Segmented, Skeleton } from '@/components/ui'

type Show = 'all' | 'review' | 'mine'

const sameId = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** You're a reviewer and haven't voted yet. */
export const awaitsReview = (pr: PullRequest, meId?: string) =>
  !pr.isDraft && !!pr.reviewers?.some((r) => sameId(r.id, meId) && !r.vote)

/** Open pull requests of the followed repository selected in the sidebar. Rows open in the browser. */
export function PullRequests() {
  const repoId = useUi((s) => s.repoId)
  const connection = useUi((s) => s.connection)!
  const repo = useWatch((s) => (repoId ? s.repos[repoId] : undefined))
  const meId = useMe().data?.id
  const pulls = usePullRequests(repo?.project, repo?.id)
  const [show, setShow] = useState<Show>('all')
  const [text, setText] = useState('')

  const all = useMemo(() => [...(pulls.data ?? [])].sort((a, b) => b.creationDate.localeCompare(a.creationDate)), [pulls.data])
  const review = all.filter((pr) => awaitsReview(pr, meId))
  const mine = all.filter((pr) => sameId(pr.createdBy.id, meId))
  const q = text.trim().toLowerCase()
  const list = (show === 'review' ? review : show === 'mine' ? mine : all).filter(
    (pr) =>
      !q ||
      `${pr.pullRequestId} ${pr.title} ${pr.createdBy.displayName} ${branchName(pr.sourceRefName)} ${branchName(pr.targetRefName)}`
        .toLowerCase()
        .includes(q.replace(/^!/, ''))
  )

  if (!repo) {
    return (
      <EmptyState icon={<FolderGit2 size={30} />} title="Repository not followed">
        <Button variant="outline" className="mt-2" onClick={() => useUi.getState().setView('inbox')}>
          Follow repositories in the Inbox
        </Button>
      </EmptyState>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-end gap-3 border-b border-line px-6 pt-1 pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-tight">
            <FolderGit2 size={18} className="text-violet-500" />
            <span className="truncate">{repo.name}</span>
          </h1>
          <p className="text-[12px] text-faint">
            {repo.project} · {pulls.data ? `${all.length} open pull request${all.length === 1 ? '' : 's'}` : 'loading…'}
            {pulls.dataUpdatedAt > 0 && ` · updated ${relativeTime(new Date(pulls.dataUpdatedAt).toISOString())}`}
          </p>
        </div>
        <Button variant="outline" onClick={() => void pulls.refetch()} disabled={pulls.isFetching} title="Refresh">
          <RefreshCw size={13} className={cn(pulls.isFetching && 'animate-spin')} />
        </Button>
        <Button variant="outline" onClick={() => void window.ado.openExternal(repoPullsWebUrl(connection, repo.project, repo.name))}>
          Open in Azure DevOps <ArrowUpRight size={13} />
        </Button>
      </header>

      <div className="flex items-center gap-2 px-6 py-3">
        <Segmented<Show>
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: <>All <Num n={all.length} /></> },
            { value: 'review', label: <>Needs my review <Num n={review.length} accent={review.length > 0} /></> },
            { value: 'mine', label: <>Mine <Num n={mine.length} /></> }
          ]}
        />
        <span className="flex-1" />
        <label className="flex h-7 w-64 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12.5px] focus-within:ring-2 focus-within:ring-[var(--ring)]">
          <Search size={13} className="text-faint" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Filter by title, !id, author, branch"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint"
          />
          {text && (
            <button onClick={() => setText('')} className="text-faint hover:text-fg">
              <X size={12} />
            </button>
          )}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {pulls.error ? (
          <ErrorState error={pulls.error} onRetry={() => void pulls.refetch()} />
        ) : pulls.isPending ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={<GitPullRequest size={30} />} title={q ? 'No matching pull requests' : show === 'review' ? 'Nothing waiting for your review' : 'No open pull requests'} />
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            {list.map((pr) => (
              <PullRow key={pr.pullRequestId} pr={pr} meId={meId} url={pullRequestWebUrl(connection, repo.project, repo.name, pr.pullRequestId)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const Num = ({ n, accent }: { n: number; accent?: boolean }) => (
  <span className={cn('rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums', accent ? 'bg-accent text-white' : 'bg-surface-3 text-muted')}>{n}</span>
)

function PullRow({ pr, meId, url }: { pr: PullRequest; meId?: string; url: string }) {
  const mineToReview = awaitsReview(pr, meId)
  return (
    <button
      onClick={() => void window.ado.openExternal(url)}
      title="Open in Azure DevOps"
      className="group flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60"
    >
      <GitPullRequest size={16} strokeWidth={2.25} className={cn('shrink-0', pr.isDraft ? 'text-faint' : 'text-violet-500')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-[11.5px] text-faint">!{pr.pullRequestId}</span>
          <span className="truncate text-[13.5px] font-medium group-hover:text-accent-fg">{pr.title}</span>
          {pr.isDraft && <Badge>Draft</Badge>}
          {pr.mergeStatus === 'conflicts' && <Badge className="bg-red-500/10 text-red-700 dark:text-red-300">Conflicts</Badge>}
          {mineToReview && <Badge className="bg-accent-soft text-accent-fg">Your review</Badge>}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-faint">
          <Avatar who={pr.createdBy} size={16} />
          <span className="text-muted">{pr.createdBy.displayName}</span>
          <span>· {relativeTime(pr.creationDate)} ·</span>
          <span className="min-w-0 truncate font-mono">
            {branchName(pr.sourceRefName)} <ArrowRight size={11} className="mx-0.5 inline" /> {branchName(pr.targetRefName)}
          </span>
        </div>
      </div>
      <Reviewers reviewers={pr.reviewers ?? []} />
      <ArrowUpRight size={14} className="shrink-0 text-faint opacity-0 group-hover:opacity-100" />
    </button>
  )
}

const Badge = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn('shrink-0 rounded-full bg-surface-2 px-2 py-px text-[10.5px] font-medium text-muted', className)}>{children}</span>
)

const VOTES: Record<number, { label: string; icon: React.ReactNode; className: string }> = {
  10: { label: 'approved', icon: <Check size={8} strokeWidth={4} />, className: 'bg-emerald-500' },
  5: { label: 'approved with suggestions', icon: <Check size={8} strokeWidth={4} />, className: 'bg-emerald-500' },
  [-5]: { label: 'waiting for author', icon: <Clock size={8} strokeWidth={3} />, className: 'bg-amber-500' },
  [-10]: { label: 'rejected', icon: <X size={8} strokeWidth={4} />, className: 'bg-red-500' }
}

function Reviewers({ reviewers }: { reviewers: NonNullable<PullRequest['reviewers']> }) {
  // Votes first, required before optional.
  const sorted = [...reviewers].sort((a, b) => Math.abs(b.vote ?? 0) - Math.abs(a.vote ?? 0) || Number(!!b.isRequired) - Number(!!a.isRequired))
  const shown = sorted.slice(0, 5)
  if (!reviewers.length) return null
  return (
    <div className="flex shrink-0 items-center gap-1">
      {shown.map((r, i) => {
        const v = VOTES[r.vote ?? 0]
        return (
          <span
            key={r.id ?? i}
            className="relative"
            title={`${r.displayName}${r.isRequired ? ' (required)' : ''}: ${v?.label ?? 'no vote yet'}`}
          >
            <Avatar who={r} size={22} className={cn(!v && 'opacity-70')} />
            {v && (
              <span className={cn('absolute -right-0.5 -bottom-0.5 grid size-3 place-items-center rounded-full text-white ring-2 ring-surface', v.className)}>
                {v.icon}
              </span>
            )}
          </span>
        )
      })}
      {sorted.length > shown.length && <span className="pl-0.5 text-[11px] text-faint">+{sorted.length - shown.length}</span>}
    </div>
  )
}

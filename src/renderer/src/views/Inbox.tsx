import { useMemo, useState } from 'react'
import { ArrowRight, ArrowUpRight, AtSign, BellOff, Check, CheckCheck, FolderGit2, GitPullRequest, Inbox as InboxIcon, Plus, RefreshCw, X } from 'lucide-react'
import type { Change } from '@/lib/changes'
import type { Meta } from '@/lib/model'
import { useMeta } from '@/lib/queries'
import { useUi } from '@/lib/store'
import { cn, pluralize, relativeTime } from '@/lib/utils'
import { checkNow, CHECK_INTERVAL_MS, isForYou, openEntry, useWatch, type InboxEntry, type Subscription } from '@/lib/watch'
import { useRepositories } from '@/lib/queries'
import type { FollowedRepo } from '@/lib/pulls'
import { Select, TagEditor, type Option } from '@/components/editors'
import { NotificationToggle } from '@/components/NotificationSetup'
import { Avatar, Button, EmptyState, Segmented, StatePill, Tag, TypeIcon } from '@/components/ui'

type Tab = 'updates' | 'subscribed'
type Show = 'all' | 'unread' | 'foryou'

const forYou = (e: InboxEntry) => e.changes.some(isForYou)

export function Inbox() {
  const [tab, setTab] = useState<Tab>('updates')
  const [show, setShow] = useState<Show>('all')
  const { inbox, subs, checking, lastCheck, error } = useWatch()
  const meta = useMeta().data
  const unread = inbox.filter((e) => !e.read).length
  const subList = Object.values(subs)
  const repoCount = useWatch((s) => Object.keys(s.repos).length)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-end gap-3 border-b border-line px-6 pt-1 pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-semibold tracking-tight">Inbox</h1>
          <p className="text-[12px] text-faint">
            Changes to items and repositories you follow, mentions and review requests ·{' '}
            {checking ? 'checking…' : lastCheck ? `checked ${relativeTime(lastCheck)}` : 'not checked yet'}
            {error && <span className="ml-1 text-red-500">· last check failed: {error}</span>}
          </p>
        </div>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'updates', label: <>Updates{unread > 0 && <Count n={unread} />}</> },
            { value: 'subscribed', label: <>Subscribed<Count n={subList.length + repoCount} muted /></> }
          ]}
        />
        <NotificationToggle />
        <Button variant="outline" onClick={() => void checkNow()} disabled={checking} title={`Checks automatically every ${CHECK_INTERVAL_MS / 60_000} minutes`}>
          <RefreshCw size={13} className={cn(checking && 'animate-spin')} /> Check now
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[880px] px-6 py-5">
          {tab === 'updates' ? (
            <Updates
              entries={show === 'unread' ? inbox.filter((e) => !e.read) : show === 'foryou' ? inbox.filter(forYou) : inbox}
              meta={meta}
              unread={unread}
              show={show}
              setShow={setShow}
              follows={subList.length}
            />
          ) : (
            <Subscribed subs={subList} meta={meta} />
          )}
        </div>
      </div>
    </div>
  )
}

const Count = ({ n, muted }: { n: number; muted?: boolean }) => (
  <span className={cn('ml-1 rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums', muted ? 'bg-surface-3 text-muted' : 'bg-accent text-white')}>{n}</span>
)

// ---- updates --------------------------------------------------------------------------

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

function Updates({
  entries,
  meta,
  unread,
  show,
  setShow,
  follows
}: {
  entries: InboxEntry[]
  meta?: Meta
  unread: number
  show: Show
  setShow(v: Show): void
  follows: number
}) {
  const { markAllRead, clearRead } = useWatch.getState()
  const groups = useMemo(() => {
    const m = new Map<string, InboxEntry[]>()
    for (const e of [...entries].sort((a, b) => b.at.localeCompare(a.at))) m.set(dayLabel(e.at), [...(m.get(dayLabel(e.at)) ?? []), e])
    return [...m]
  }, [entries])

  return (
    <>
      <div className="mb-4 flex items-center gap-2 text-[12px]">
        <Segmented<Show>
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: 'Unread' },
            {
              value: 'foryou',
              title: 'Mentions and review requests',
              label: (
                <>
                  <AtSign size={12} /> For you
                </>
              )
            }
          ]}
        />
        <span className="flex-1" />
        {unread > 0 && (
          <Button onClick={markAllRead}>
            <CheckCheck size={14} /> Mark all read
          </Button>
        )}
        {entries.some((e) => e.read) && show === 'all' && <Button onClick={clearRead}>Clear read</Button>}
      </div>

      {groups.length === 0 ? (
        <div className="pt-10">
          <EmptyState
            icon={show === 'foryou' ? <AtSign size={30} /> : <InboxIcon size={30} />}
            title={show === 'unread' ? 'No unread updates' : show === 'foryou' ? 'Nothing for you yet' : 'You’re all caught up'}
          >
            {show === 'foryou'
              ? 'When someone @mentions you in a work item or asks for your review on a pull request, it shows up here and as a notification.'
              : `You follow ${pluralize(follows, 'item')}. When someone else changes one of them, comments on it or @mentions you anywhere, it shows up here and as a notification.`}
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([label, list]) => (
            <section key={label}>
              <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">{label}</h2>
              <div className="space-y-2.5">
                {list.map((e) => (
                  <EntryCard key={e.key} entry={e} meta={meta} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

function EntryCard({ entry: e, meta }: { entry: InboxEntry; meta?: Meta }) {
  const { markEntryRead, dismiss } = useWatch.getState()
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? e.changes : e.changes.slice(0, 6)
  return (
    <article
      className={cn(
        'group relative rounded-xl border bg-surface p-4 shadow-card transition-colors',
        e.read ? 'border-line' : 'border-accent/40 bg-[linear-gradient(to_right,var(--accent-soft),transparent_30%)]'
      )}
    >
      <div className="flex items-center gap-2">
        {!e.read && <span className="size-2 shrink-0 rounded-full bg-accent" title="Unread" />}
        {e.pr ? (
          <GitPullRequest size={14} strokeWidth={2.25} className="shrink-0 text-violet-500" aria-label="Pull request" />
        ) : (
          meta && <TypeIcon meta={meta} type={e.type} />
        )}
        <span className="font-mono text-[11.5px] text-faint">{e.pr ? `!${e.id}` : e.id}</span>
        <button
          onClick={() => openEntry(e.key)}
          className="flex min-w-0 items-center gap-1 text-left text-[13.5px] font-semibold hover:text-accent-fg hover:underline"
          title={e.pr ? 'Open the pull request in Azure DevOps' : undefined}
        >
          <span className="truncate">{e.title}</span>
          {e.pr && <ArrowUpRight size={13} className="shrink-0 text-faint" />}
        </button>
        {e.pr ? (
          <>
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted" title={`${e.pr.project} / ${e.pr.repo}`}>
              <FolderGit2 size={11} /> {e.pr.repo}
            </span>
            {e.pr.draft && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">Draft</span>}
          </>
        ) : (
          <StatePill meta={meta} type={e.type} state={e.state} className="shrink-0" />
        )}
        {forYou(e) && (
          <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-accent-fg">
            <AtSign size={11} /> For you
          </span>
        )}
        <span className="flex-1" />
        <span className="shrink-0 text-[11.5px] text-faint" title={new Date(e.at).toLocaleString()}>
          {relativeTime(e.at)}
        </span>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
          {!e.read && (
            <button onClick={() => markEntryRead(e.key)} className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-fg" title="Mark read">
              <Check size={14} />
            </button>
          )}
          <button onClick={() => dismiss(e.key)} className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-fg" title="Remove from inbox">
            <X size={14} />
          </button>
        </div>
      </div>
      {e.pr && (
        <div className="mt-1.5 ml-[22px] truncate font-mono text-[11px] text-faint">
          {e.pr.source} <ArrowRight size={11} className="mx-0.5 inline" /> {e.pr.target}
        </div>
      )}
      <ul className="mt-3 space-y-2.5">
        {shown.map((c, i) => (
          <ChangeRow key={i} change={c} meta={meta} type={e.type} />
        ))}
      </ul>
      {e.changes.length > shown.length && (
        <button onClick={() => setExpanded(true)} className="mt-2 ml-8 text-[12px] text-faint hover:text-fg">
          Show {pluralize(e.changes.length - shown.length, 'more change')}
        </button>
      )}
    </article>
  )
}

function ChangeRow({ change: c, meta, type }: { change: Change; meta?: Meta; type: string }) {
  return (
    <li className="flex gap-2.5">
      <Avatar who={c.by} size={20} className="mt-px" />
      <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
        <span className="font-medium">{c.by.displayName}</span> <ChangeBody change={c} meta={meta} type={type} />
        <span className="ml-1.5 text-[11px] text-faint" title={new Date(c.at).toLocaleString()}>
          {relativeTime(c.at)}
        </span>
        {c.kind === 'comment' && (
          <blockquote className="mt-1 line-clamp-3 rounded-lg bg-surface-2 px-3 py-2 text-muted select-text">{c.text || 'Comment text unavailable'}</blockquote>
        )}
        {c.kind === 'mention' && (
          <blockquote className="mt-1 line-clamp-3 rounded-lg border-l-2 border-accent bg-accent-soft/60 px-3 py-2 text-fg select-text">
            {c.text || 'Text unavailable'}
          </blockquote>
        )}
        {c.kind === 'text' && (c.added.length > 0 || c.removed.length > 0) && (
          <div className="mt-1 space-y-px overflow-hidden rounded-lg border border-line text-[12px] select-text">
            {c.removed.map((l, i) => (
              <div key={`r${i}`} className="flex gap-2 bg-red-500/8 px-2.5 py-0.5 text-red-700 dark:text-red-300">
                <span className="select-none">−</span>
                <span className="min-w-0 truncate line-through decoration-red-400/60">{l}</span>
              </div>
            ))}
            {c.added.map((l, i) => (
              <div key={`a${i}`} className="flex gap-2 bg-emerald-500/8 px-2.5 py-0.5 text-emerald-800 dark:text-emerald-300">
                <span className="select-none">+</span>
                <span className="min-w-0 truncate">{l}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </li>
  )
}

const Old = ({ children }: { children: React.ReactNode }) => <span className="text-faint line-through">{children}</span>
const New = ({ children }: { children: React.ReactNode }) => <span className="font-medium">{children}</span>
const Arrow = () => <ArrowRight size={12} className="mx-1 inline text-faint" />

function ChangeBody({ change: c, meta, type }: { change: Change; meta?: Meta; type: string }) {
  const openItem = useUi((s) => s.openItem)
  switch (c.kind) {
    case 'comment':
      return <span className="text-muted">commented</span>
    case 'pr':
      return c.event === 'opened' ? (
        <span className="text-muted">
          opened a pull request into <span className="font-mono text-[11.5px] text-fg">{c.target}</span>
        </span>
      ) : (
        <span className="text-muted">
          wants <span className="rounded bg-accent-soft px-1 font-medium text-accent-fg">your</span> review
          {c.required && <span className="ml-1 font-medium text-fg">(required reviewer)</span>}
        </span>
      )
    case 'mention':
      return (
        <span className="text-muted">
          mentioned <span className="rounded bg-accent-soft px-1 font-medium text-accent-fg">you</span>{' '}
          {c.where === 'comment' ? 'in a comment' : `in the ${c.where.toLowerCase()}`}
        </span>
      )
    case 'text':
      return <span className="text-muted">edited the {c.label.toLowerCase()}</span>
    case 'tags':
      return (
        <span className="text-muted">
          {c.added.length > 0 && 'added '}
          {c.added.map((t) => (
            <span key={t} className="mr-1 inline-block align-middle">
              <Tag name={t} />
            </span>
          ))}
          {c.added.length > 0 && c.removed.length > 0 && 'and '}
          {c.removed.length > 0 && 'removed '}
          {c.removed.map((t) => (
            <span key={t} className="mr-1 inline-block align-middle line-through opacity-60">
              <Tag name={t} />
            </span>
          ))}
        </span>
      )
    case 'state':
      return (
        <span className="text-muted">
          moved it{' '}
          {c.from && (
            <>
              from <StatePill meta={meta} type={type} state={c.from} className="align-middle" />{' '}
            </>
          )}
          to <StatePill meta={meta} type={type} state={c.to ?? '—'} className="align-middle" />
        </span>
      )
    case 'assigned':
      return (
        <span className="text-muted">
          {c.to ? (
            <>
              assigned it to <New>{c.to === c.by.displayName ? 'themselves' : c.to}</New>
              {c.from && (
                <>
                  {' '}
                  (was <Old>{c.from}</Old>)
                </>
              )}
            </>
          ) : (
            <>
              unassigned <Old>{c.from}</Old>
            </>
          )}
        </span>
      )
    case 'field':
      return (
        <span className="text-muted">
          {c.from === undefined ? (
            <>
              set {c.label} to <New>{c.to}</New>
            </>
          ) : c.to === undefined ? (
            <>
              cleared {c.label} (was <Old>{c.from}</Old>)
            </>
          ) : (
            <>
              changed {c.label} <Old>{c.from}</Old>
              <Arrow />
              <New>{c.to}</New>
            </>
          )}
        </span>
      )
    case 'link':
      return (
        <span className="text-muted">
          {c.action} {c.action === 'added' ? 'a' : 'the'} {c.label}{' '}
          {c.targetId && (
            <button onClick={() => openItem(c.targetId!)} className="font-mono font-medium text-accent-fg hover:underline">
              #{c.targetId}
            </button>
          )}
        </span>
      )
  }
}

// ---- subscriptions ----------------------------------------------------------------------

function Subscribed({ subs, meta }: { subs: Subscription[]; meta?: Meta }) {
  const muted = useWatch((s) => s.muted)
  const manual = subs.filter((s) => s.source === 'manual').sort((a, b) => b.since.localeCompare(a.since))
  const auto = subs.filter((s) => s.source === 'auto').sort((a, b) => b.id - a.id)
  return (
    <div className="space-y-6">
      <Repositories />
      {subs.length === 0 && (
        <div className="pt-10">
          <EmptyState icon={<BellOff size={30} />} title="No subscriptions yet">
            Open items you created are followed automatically. Subscribe to any other item with the bell in its panel.
          </EmptyState>
        </div>
      )}
      {manual.length > 0 && <SubSection title="Subscribed by you" subs={manual} meta={meta} />}
      {auto.length > 0 && <SubSection title="Created by you · open" subs={auto} meta={meta} />}
      {muted.length > 0 && (
        <p className="text-[12px] text-faint">
          You unsubscribed from {pluralize(muted.length, 'item')} you created.{' '}
          <button
            className="font-medium text-accent-fg hover:underline"
            onClick={() => {
              useWatch.setState({ muted: [] })
              void checkNow()
            }}
          >
            Follow them again
          </button>
        </p>
      )}
    </div>
  )
}

function Repositories() {
  const repos = useWatch((s) => s.repos)
  const repoError = useWatch((s) => s.repoError)
  const { followRepo, unfollowRepo, setRepoBranches } = useWatch.getState()
  const all = useRepositories(true)
  const list = Object.values(repos).sort((a, b) => a.name.localeCompare(b.name))
  const options: Option[] = (all.data ?? [])
    .filter((r) => !repos[r.id])
    .map((r) => ({ value: r.id, label: r.name, group: r.project.name, icon: <FolderGit2 size={13} className="text-faint" /> }))

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="flex-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
          Repositories <span className="font-normal">· {list.length}</span>
        </h2>
        <Select
          options={options}
          width={340}
          placeholder={all.isPending ? 'Loading repositories…' : 'Search repositories…'}
          onChange={(id) => {
            const r = all.data?.find((x) => x.id === id)
            if (r) followRepo({ id: r.id, name: r.name, project: r.project.name })
          }}
          trigger={(open) => (
            <span className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-muted hover:bg-surface-2 hover:text-fg', open && 'bg-surface-2 text-fg')}>
              <Plus size={13} /> Follow repository
            </span>
          )}
        />
      </div>
      {all.error && (
        <p className="mb-2 rounded-lg bg-red-500/8 px-3 py-2 text-[12px] text-red-700 select-text dark:text-red-300">
          Couldn’t list repositories: {(all.error as Error).message}. The PAT needs the scope <b>Code (Read)</b>.
        </p>
      )}
      {repoError && !all.error && (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 select-text dark:text-amber-300">
          Last pull request check: {repoError}
        </p>
      )}
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-3 text-[12.5px] text-faint">
          Follow a repository to be notified about new pull requests. Review requests reach you either way.
        </p>
      ) : (
        <div className="divide-y divide-line rounded-xl border border-line bg-surface shadow-card">
          {list.map((r) => (
            <RepoRow key={r.id} repo={r} onBranches={(b) => setRepoBranches(r.id, b)} onUnfollow={() => unfollowRepo(r.id)} />
          ))}
        </div>
      )}
    </section>
  )
}

function RepoRow({ repo, onBranches, onUnfollow }: { repo: FollowedRepo; onBranches(b: string[]): void; onUnfollow(): void }) {
  return (
    <div className="group flex items-center gap-2.5 px-3.5 py-2">
      <FolderGit2 size={14} className="shrink-0 text-violet-500" />
      <span className="min-w-0 truncate text-[13px] font-medium">{repo.name}</span>
      <span className="shrink-0 text-[11.5px] text-faint">{repo.project}</span>
      <span className="flex-1" />
      <span className="shrink-0 text-[11.5px] text-faint">into</span>
      <TagEditor tags={repo.branches} suggestions={['develop', 'main', 'master']} onChange={onBranches} addLabel="Branch" />
      {repo.branches.length === 0 && <span className="shrink-0 text-[11.5px] text-faint">any branch</span>}
      <button
        onClick={onUnfollow}
        className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-fg"
        title="Stop following"
      >
        <BellOff size={13} /> Unfollow
      </button>
    </div>
  )
}

function SubSection({ title, subs, meta }: { title: string; subs: Subscription[]; meta?: Meta }) {
  const openItem = useUi((s) => s.openItem)
  const unsubscribe = useWatch((s) => s.unsubscribe)
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
        {title} <span className="font-normal">· {subs.length}</span>
      </h2>
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {subs.map((s) => (
          <div key={s.id} className="group flex items-center gap-2.5 px-3.5 py-2">
            {meta && <TypeIcon meta={meta} type={s.type} />}
            <span className="w-12 shrink-0 font-mono text-[11.5px] text-faint">{s.id}</span>
            <button onClick={() => openItem(s.id)} className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-accent-fg hover:underline">
              {s.title}
            </button>
            <StatePill meta={meta} type={s.type} state={s.state} className="shrink-0" />
            <button
              onClick={() => unsubscribe(s.id)}
              className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-fg"
              title="Unsubscribe"
            >
              <BellOff size={13} /> Unsubscribe
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

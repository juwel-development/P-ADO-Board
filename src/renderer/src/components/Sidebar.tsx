import { useState } from 'react'
import { ChevronDown, ChevronRight, Command, Eye, FileText, FolderGit2, Inbox, Kanban, Monitor, Moon, PanelLeftClose, Plus, Settings, ShieldCheck, Sun } from 'lucide-react'
import type { WriteMode } from '@shared/ipc'
import type { FollowedRepo } from '@/lib/pulls'
import type { PullRequest } from '@/lib/api'
import { useIterations, useMe, useMeta, usePullRequestsOf } from '@/lib/queries'
import { useUi, type ThemePref } from '@/lib/store'
import type { Iteration } from '@/lib/types'
import { cn, formatDate } from '@/lib/utils'
import { useUnreadCount, useWatch } from '@/lib/watch'
import { awaitsReview } from '@/views/PullRequests'
import { Kbd, Skeleton, TypeIcon } from './ui'

export function Sidebar() {
  const ui = useUi()
  const meta = useMeta().data
  const iterations = useIterations()
  const [showPast, setShowPast] = useState(false)
  const unread = useUnreadCount()
  const repos = useWatch((s) => s.repos)
  const followed = Object.values(repos)
  const pulls = usePullRequestsOf(followed)
  // Most open pull requests first; repositories still loading go last; ties alphabetically.
  const repoList = followed
    .map((repo, i) => ({ repo, prs: pulls[i]?.data }))
    .sort((a, b) => (b.prs?.length ?? -1) - (a.prs?.length ?? -1) || a.repo.name.localeCompare(b.repo.name))
  const isMac = window.ado.platform === 'darwin'

  const list = iterations.data ?? []
  const current = list.filter((i) => i.attributes.timeFrame === 'current')
  const future = list.filter((i) => i.attributes.timeFrame === 'future')
  const past = list.filter((i) => i.attributes.timeFrame === 'past').reverse()

  if (ui.sidebarCollapsed) return null

  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-line bg-surface">
      <div className={cn('drag flex h-12 items-center gap-2 px-3', isMac && 'pl-[84px]')}>
        <div className="flex-1" />
        <button
          onClick={ui.toggleSidebar}
          className="no-drag rounded-md p-1 text-faint hover:bg-surface-2 hover:text-fg"
          title="Hide sidebar  (⌘\)"
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      <button
        onClick={() => ui.setSettingsOpen(true)}
        className="mx-2 mb-2 flex items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-surface-2"
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-[13px] font-bold text-white shadow-card">
          {ui.connection?.team.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{ui.connection?.team}</div>
          <div className="truncate text-[11.5px] text-faint">{ui.connection?.project}</div>
        </div>
        <ChevronDown size={14} className="text-faint" />
      </button>

      {ui.writeMode !== 'off' && (
        <button
          onClick={() => ui.openCreate({})}
          className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-2.5 py-1.5 text-[12.5px] font-medium text-muted shadow-card hover:border-line-strong hover:text-fg"
        >
          <Plus size={14} /> New work item
          <span className="flex-1" />
          <Kbd>C</Kbd>
        </button>
      )}

      <nav className="flex-1 space-y-5 overflow-y-auto px-2 pb-4">
        <NavItem
          active={ui.view === 'inbox'}
          onClick={() => ui.setView('inbox')}
          icon={<Inbox size={14} />}
          trailing={
            unread > 0 && <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold text-white tabular-nums">{unread}</span>
          }
        >
          Inbox
        </NavItem>
        <Section title="Backlogs">
          {meta
            ? meta.levels.map((l) => (
                <NavItem
                  key={l.id}
                  active={ui.view === 'backlog' && ui.backlogLevelId === l.id}
                  onClick={() => ui.setBacklogLevel(l.id)}
                  icon={<TypeIcon meta={meta} type={l.defaultWorkItemType?.name ?? l.workItemTypes[0]?.name} />}
                >
                  {l.name}
                </NavItem>
              ))
            : [0, 1, 2].map((i) => <Skeleton key={i} className="mx-2 my-2 h-4" />)}
        </Section>

        <Section title="Sprints">
          {iterations.isPending && [0, 1, 2].map((i) => <Skeleton key={i} className="mx-2 my-2 h-4" />)}
          {current.map((it) => (
            <SprintItem key={it.id} it={it} badge="Current" />
          ))}
          {future.slice(0, 4).map((it) => (
            <SprintItem key={it.id} it={it} />
          ))}
          {past.length > 0 && (
            <button
              onClick={() => setShowPast((s) => !s)}
              className="flex w-full items-center gap-1 px-2 py-1.5 text-[12px] text-faint hover:text-muted"
            >
              {showPast ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Past sprints
            </button>
          )}
          {showPast && past.slice(0, 12).map((it) => <SprintItem key={it.id} it={it} muted />)}
        </Section>

        {repoList.length > 0 && (
          <Section title="Repositories">
            {repoList.map(({ repo, prs }) => (
              <RepoItem key={repo.id} repo={repo} prs={prs} />
            ))}
          </Section>
        )}
      </nav>

      <WriteModeBadge mode={ui.writeMode} />
      <div className="flex items-center gap-1 border-t border-line px-2 py-2">
        <ThemeSwitch value={ui.theme} onChange={ui.setTheme} />
        <div className="flex-1" />
        <button
          onClick={() => ui.setPaletteOpen(true)}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-faint hover:bg-surface-2 hover:text-fg"
          title="Command palette"
        >
          <Kbd>
            <Command size={10} />
          </Kbd>
          <Kbd>K</Kbd>
        </button>
        <button
          onClick={() => ui.setTemplatesOpen(true)}
          className="rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-fg"
          title="Description templates"
        >
          <FileText size={15} />
        </button>
        <button
          onClick={() => ui.setSettingsOpen(true)}
          className="rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-fg"
          title="Connection settings"
        >
          <Settings size={15} />
        </button>
      </div>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{title}</div>
      <div className="space-y-px">{children}</div>
    </div>
  )
}

function NavItem({
  active,
  icon,
  children,
  onClick,
  trailing,
  muted
}: {
  active?: boolean
  icon: React.ReactNode
  children: React.ReactNode
  onClick(): void
  trailing?: React.ReactNode
  muted?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
        active ? 'bg-accent-soft font-medium text-accent-fg' : muted ? 'text-faint hover:bg-surface-2 hover:text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
      )}
    >
      <span className="grid w-4 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </button>
  )
}

function SprintItem({ it, badge, muted }: { it: Iteration; badge?: string; muted?: boolean }) {
  const ui = useUi()
  const active = ui.view === 'board' && ui.iterationId === it.id
  const dates = it.attributes.startDate
    ? `${formatDate(it.attributes.startDate)} – ${formatDate(it.attributes.finishDate)}`
    : 'No dates'
  return (
    <NavItem
      active={active}
      muted={muted}
      onClick={() => ui.setIteration(it.id)}
      icon={<Kanban size={14} className={badge ? 'text-accent' : undefined} />}
      trailing={
        badge ? (
          <span className="rounded bg-accent px-1.5 py-px text-[10px] font-semibold text-white">{badge}</span>
        ) : (
          <span className="text-[11px] text-faint opacity-0 group-hover:opacity-100">{dates}</span>
        )
      }
    >
      {it.name}
    </NavItem>
  )
}

function RepoItem({ repo, prs }: { repo: FollowedRepo; prs?: PullRequest[] }) {
  const ui = useUi()
  const meId = useMe().data?.id
  const open = prs?.length
  const toReview = prs?.filter((pr) => awaitsReview(pr, meId)).length ?? 0
  return (
    <NavItem
      active={ui.view === 'repo' && ui.repoId === repo.id}
      onClick={() => ui.setRepo(repo.id)}
      icon={<FolderGit2 size={14} className="text-violet-500" />}
      trailing={
        <span className="flex items-center gap-1.5">
          {toReview > 0 && <span className="size-1.5 rounded-full bg-accent" title={`${toReview} waiting for your review`} />}
          {open !== undefined && <span className="text-[11px] text-faint tabular-nums" title={`${open} open pull requests`}>{open}</span>}
        </span>
      }
    >
      <span title={`${repo.project} / ${repo.name}`}>{repo.name}</span>
    </NavItem>
  )
}

function ThemeSwitch({ value, onChange }: { value: ThemePref; onChange(t: ThemePref): void }) {
  const opts: { v: ThemePref; icon: React.ReactNode; label: string }[] = [
    { v: 'light', icon: <Sun size={13} />, label: 'Light' },
    { v: 'system', icon: <Monitor size={13} />, label: 'System' },
    { v: 'dark', icon: <Moon size={13} />, label: 'Dark' }
  ]
  return (
    <div className="flex rounded-md bg-surface-2 p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          title={o.label}
          onClick={() => onChange(o.v)}
          className={cn('rounded p-1', value === o.v ? 'bg-surface text-fg shadow-card' : 'text-faint hover:text-fg')}
        >
          {o.icon}
        </button>
      ))}
    </div>
  )
}

function WriteModeBadge({ mode }: { mode: WriteMode }) {
  if (mode === 'live') return null
  return (
    <div
      className={cn(
        'mx-2 mb-2 flex items-start gap-2 rounded-lg px-2.5 py-2 text-[11.5px]',
        mode === 'off' ? 'bg-surface-2 text-muted' : 'bg-amber-500/12 text-amber-800 dark:text-amber-300'
      )}
    >
      {mode === 'off' ? <Eye size={14} className="mt-px shrink-0" /> : <ShieldCheck size={14} className="mt-px shrink-0" />}
      <span>
        <span className="font-semibold">{mode === 'off' ? 'Read-only' : 'Validate mode'}</span>
        <br />
        {mode === 'off' ? 'Editing is turned off.' : 'Changes are checked by Azure DevOps but never saved.'}
      </span>
    </div>
  )
}

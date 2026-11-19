import { useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { useQueryClient } from '@tanstack/react-query'
import { BellRing, FileText, Hash, Inbox, Kanban, Monitor, Moon, PanelLeft, Plus, RefreshCw, Settings, Sun } from 'lucide-react'
import { useIterations, useMeta } from '@/lib/queries'
import { useUi } from '@/lib/store'
import { checkNow } from '@/lib/watch'
import type { WorkItem } from '@/lib/types'
import { Kbd, TypeIcon } from './ui'

/** All work items currently in the query cache (sprint + backlog + linked), deduplicated. */
function useCachedItems(open: boolean): WorkItem[] {
  const qc = useQueryClient()
  return useMemo(() => {
    if (!open) return []
    const seen = new Map<number, WorkItem>()
    for (const [, data] of qc.getQueriesData<unknown>({})) {
      const d = data as { items?: WorkItem[]; outsideParents?: WorkItem[]; ancestors?: WorkItem[] } | WorkItem[] | undefined
      const lists = Array.isArray(d) ? [d] : [d?.items, d?.outsideParents, d?.ancestors]
      for (const l of lists) for (const w of l ?? []) if (w && typeof w === 'object' && 'title' in w) seen.set(w.id, w)
    }
    return [...seen.values()]
  }, [qc, open])
}

export function CommandPalette() {
  const ui = useUi()
  const meta = useMeta().data
  const iterations = useIterations().data ?? []
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const items = useCachedItems(ui.paletteOpen)

  if (!ui.paletteOpen) return null
  const close = () => {
    ui.setPaletteOpen(false)
    setQ('')
  }
  const run = (fn: () => void) => () => {
    fn()
    close()
  }
  const idQuery = q.trim().replace(/^#/, '')
  const isId = /^\d+$/.test(idQuery)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh]" onMouseDown={close}>
      <div className="animate-fade-in absolute inset-0 bg-black/20 dark:bg-black/50" />
      <Command
        label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
        className="animate-pop-in relative w-[620px] overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
        loop
      >
        <Command.Input
          autoFocus
          value={q}
          onValueChange={setQ}
          placeholder="Search work items, sprints, actions… or type an ID"
          className="h-12 w-full border-b border-line bg-transparent px-4 text-[14px] outline-none placeholder:text-faint"
        />
        <Command.List className="max-h-[420px] overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-faint">
          <Command.Empty className="py-8 text-center text-faint">No results</Command.Empty>

          {isId && (
            <Command.Group heading="Open">
              <Item value={`open #${idQuery}`} onSelect={run(() => ui.openItem(Number(idQuery)))} icon={<Hash size={14} />}>
                Open work item #{idQuery}
              </Item>
            </Command.Group>
          )}

          {q.length > 1 && (
            <Command.Group heading="Work items">
              {items.slice(0, 400).map((w) => (
                <Item
                  key={w.id}
                  value={`${w.id} ${w.title} ${w.assignedTo?.displayName ?? ''}`}
                  onSelect={run(() => ui.openItem(w.id))}
                  icon={<TypeIcon meta={meta} type={w.type} />}
                  hint={w.state}
                >
                  <span className="mr-2 font-mono text-[11px] text-faint">{w.id}</span>
                  {w.title}
                </Item>
              ))}
            </Command.Group>
          )}

          <Command.Group heading="Go to">
            <Item value="inbox notifications subscriptions updates" onSelect={run(() => ui.setView('inbox'))} icon={<Inbox size={14} />} kbd="3">
              Inbox
            </Item>
            {iterations
              .filter((i) => i.attributes.timeFrame !== 'past')
              .map((it) => (
                <Item key={it.id} value={`sprint ${it.name}`} onSelect={run(() => ui.setIteration(it.id))} icon={<Kanban size={14} />}>
                  {it.name}
                  {it.attributes.timeFrame === 'current' && <span className="ml-2 text-[11px] text-accent-fg">current</span>}
                </Item>
              ))}
            {meta?.levels.map((l) => (
              <Item
                key={l.id}
                value={`backlog ${l.name}`}
                onSelect={run(() => ui.setBacklogLevel(l.id))}
                icon={<TypeIcon meta={meta} type={l.defaultWorkItemType?.name ?? l.workItemTypes[0]?.name} />}
              >
                {l.name} backlog
              </Item>
            ))}
          </Command.Group>

          <Command.Group heading="Actions">
            {ui.writeMode !== 'off' && (
              <Item value="new create work item add" onSelect={run(() => ui.openCreate({}))} icon={<Plus size={14} />} kbd="C">
                New work item…
              </Item>
            )}
            <Item value="templates description manage" onSelect={run(() => ui.setTemplatesOpen(true))} icon={<FileText size={14} />}>
              Description templates…
            </Item>
            <Item value="check subscriptions now notifications" onSelect={run(() => void checkNow())} icon={<BellRing size={14} />}>
              Check subscriptions now
            </Item>
            <Item value="refresh reload" onSelect={run(() => qc.invalidateQueries())} icon={<RefreshCw size={14} />} kbd="R">
              Refresh data
            </Item>
            <Item value="toggle sidebar" onSelect={run(ui.toggleSidebar)} icon={<PanelLeft size={14} />} kbd="⌘\">
              Toggle sidebar
            </Item>
            <Item value="theme light" onSelect={run(() => ui.setTheme('light'))} icon={<Sun size={14} />}>
              Light theme
            </Item>
            <Item value="theme dark" onSelect={run(() => ui.setTheme('dark'))} icon={<Moon size={14} />}>
              Dark theme
            </Item>
            <Item value="theme system" onSelect={run(() => ui.setTheme('system'))} icon={<Monitor size={14} />}>
              System theme
            </Item>
            <Item value="settings connection project team" onSelect={run(() => ui.setSettingsOpen(true))} icon={<Settings size={14} />}>
              Switch project / team…
            </Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  )
}

function Item({
  children,
  icon,
  hint,
  kbd,
  ...props
}: React.ComponentProps<typeof Command.Item> & { icon?: React.ReactNode; hint?: string; kbd?: string }) {
  return (
    <Command.Item
      {...props}
      className="flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-muted data-[selected=true]:bg-accent-soft data-[selected=true]:text-fg"
    >
      <span className="grid w-4 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
      {kbd && <Kbd>{kbd}</Kbd>}
    </Command.Item>
  )
}

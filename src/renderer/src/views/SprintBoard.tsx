import { useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import {
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns3,
  Kanban,
  ListTree,
  Plus,
  RefreshCw,
  Users
} from 'lucide-react'
import { FilterBar } from '@/components/FilterBar'
import { WorkItemCard } from '@/components/WorkItemCard'
import { Avatar, Button, EmptyState, ErrorState, ProgressBar, Segmented, Skeleton, StatePill, TypeIcon } from '@/components/ui'
import { sprintWebUrl } from '@/lib/api'
import { buildLanes, isTaskLevel, matchesFilters, stateInfo, type Lane, type Meta } from '@/lib/model'
import { identityValue, useCreateWorkItem, useUpdateWorkItem, type FieldChange } from '@/lib/mutations'
import { useIterations, useMe, useMeta, useSprint } from '@/lib/queries'
import { isFiltering, useCanEdit, useUi, type GroupBy } from '@/lib/store'
import { toast } from '@/lib/toasts'
import type { Iteration, TaskboardColumn, WorkItem } from '@/lib/types'
import { cn, fmtNum, formatDate, pluralize, sum, workingDays } from '@/lib/utils'

export function SprintBoard() {
  const ui = useUi()
  const meta = useMeta()
  const me = useMe().data
  const iteration = useIterations().data?.find((i) => i.id === ui.iterationId)
  const sprint = useSprint(ui.iterationId, meta.data)
  const canEdit = useCanEdit()

  const filtering = isFiltering(ui.filters)
  const lanes = useMemo(() => {
    if (!sprint.data || !meta.data) return []
    return buildLanes({
      meta: meta.data,
      ...sprint.data,
      groupBy: ui.groupBy,
      filter: (w) => matchesFilters(w, ui.filters, me?.id),
      filtering
    })
  }, [sprint.data, meta.data, ui.groupBy, ui.filters, me?.id, filtering])

  if (!iteration) return <EmptyState icon={<Kanban size={28} />} title="Pick a sprint from the sidebar" />
  if (meta.error || sprint.error) return <ErrorState error={meta.error ?? sprint.error} onRetry={() => sprint.refetch()} />

  const cards = sprint.data && meta.data ? sprint.data.items.filter((w) => isTaskLevel(meta.data!, w)) : []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SprintHeader iteration={iteration} cards={cards} meta={meta.data} loading={sprint.isPending} />
      <div className="flex items-center gap-2 border-b border-line px-5 py-2">
        <FilterBar items={cards} meta={meta.data} />
        <div className="flex-1" />
        <Segmented<GroupBy>
          value={ui.groupBy}
          onChange={ui.setGroupBy}
          options={[
            { value: 'parent', label: <ListTree size={13} />, title: 'Group by backlog item' },
            { value: 'person', label: <Users size={13} />, title: 'Group by person' },
            { value: 'none', label: <Columns3 size={13} />, title: 'No grouping' }
          ]}
        />
        {ui.groupBy !== 'none' && (
          <ExpandCollapse lanes={lanes} />
        )}
        {canEdit && (
          <Button variant="outline" onClick={() => ui.openCreate({ iterationPath: iteration.path })} title="New work item in this sprint  (C)">
            <Plus size={13} /> New
          </Button>
        )}
        <Button onClick={() => sprint.refetch()} title="Refresh  (R)">
          <RefreshCw size={13} className={cn(sprint.isFetching && 'animate-spin')} />
        </Button>
      </div>

      {sprint.isPending || !meta.data ? (
        <BoardSkeleton />
      ) : lanes.length === 0 ? (
        <EmptyState title={filtering ? 'Nothing matches your filters' : 'This sprint is empty'}>
          {filtering ? 'Try removing a filter.' : 'No work items are planned for this iteration yet.'}
        </EmptyState>
      ) : (
        <Board lanes={lanes} columns={sprint.data.columns} meta={meta.data} groupBy={ui.groupBy} iterationPath={iteration.path} />
      )}
    </div>
  )
}

function ExpandCollapse({ lanes }: { lanes: Lane[] }) {
  const { collapsed, setAllCollapsed } = useUi()
  const anyOpen = lanes.some((l) => !collapsed[l.key])
  return (
    <Button onClick={() => setAllCollapsed(lanes.map((l) => l.key), anyOpen)} title={anyOpen ? 'Collapse all' : 'Expand all'}>
      {anyOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
    </Button>
  )
}

function SprintHeader({
  iteration,
  cards,
  meta,
  loading
}: {
  iteration: Iteration
  cards: WorkItem[]
  meta?: Meta
  loading: boolean
}) {
  const connection = useUi((s) => s.connection)!
  const { startDate, finishDate, timeFrame } = iteration.attributes
  const daysLeft =
    finishDate && timeFrame !== 'past'
      ? workingDays(timeFrame === 'future' && startDate ? new Date(startDate) : new Date(), new Date(finishDate))
      : 0

  const byCat = { Proposed: 0, InProgress: 0, Resolved: 0, Completed: 0 }
  if (meta)
    for (const w of cards) {
      const c = stateInfo(meta, w.type, w.state).category
      if (c in byCat) byCat[c as keyof typeof byCat]++
    }
  const total = byCat.Proposed + byCat.InProgress + byCat.Resolved + byCat.Completed
  const pct = total ? Math.round((byCat.Completed / total) * 100) : 0
  const remaining = sum(cards.map((w) => w.remaining))

  return (
    <header className="flex items-end gap-6 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[12px] text-faint">
          <CalendarDays size={13} />
          {startDate ? `${formatDate(startDate)} – ${formatDate(finishDate, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'No dates set'}
          {timeFrame === 'current' && (
            <span className="rounded-full bg-accent-soft px-2 py-px text-[11px] font-medium text-accent-fg">
              {pluralize(daysLeft, 'working day')} left
            </span>
          )}
          {timeFrame === 'future' && <span className="rounded-full bg-surface-2 px-2 py-px text-[11px]">Upcoming · {daysLeft} days</span>}
          {timeFrame === 'past' && <span className="rounded-full bg-surface-2 px-2 py-px text-[11px]">Completed</span>}
        </div>
        <h1 className="mt-1 flex items-center gap-2 text-[20px] font-semibold tracking-tight">
          {iteration.name}
          <button
            onClick={() => window.ado.openExternal(sprintWebUrl(connection, iteration))}
            className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-fg"
            title="Open in Azure DevOps"
          >
            <ArrowUpRight size={15} />
          </button>
        </h1>
      </div>
      <div className="flex-1" />
      {loading ? (
        <Skeleton className="h-10 w-72" />
      ) : (
        <div className="flex items-end gap-6">
          <Stat label="Done" value={`${pct}%`} />
          <Stat label="Items" value={String(total)} />
          <Stat label="Remaining" value={`${fmtNum(remaining)}h`} />
          <div className="w-56 pb-1.5">
            <ProgressBar
              segments={[
                { value: byCat.Completed, color: '#22a06b' },
                { value: byCat.Resolved, color: '#5aa9e6' },
                { value: byCat.InProgress, color: 'var(--accent)' },
                { value: byCat.Proposed, color: 'transparent' }
              ]}
            />
            <div className="mt-1.5 flex justify-between text-[11px] text-faint">
              <span>{byCat.Proposed} to do</span>
              <span>{byCat.InProgress + byCat.Resolved} in progress</span>
              <span>{byCat.Completed} done</span>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <div className="text-[11px] font-medium text-faint">{label}</div>
    <div className="text-[18px] font-semibold tabular-nums tracking-tight">{value}</div>
  </div>
)

function Board({
  lanes,
  columns,
  meta,
  groupBy,
  iterationPath
}: {
  lanes: Lane[]
  columns: TaskboardColumn[]
  meta: Meta
  groupBy: GroupBy
  iterationPath: string
}) {
  const gridCols = { gridTemplateColumns: `repeat(${columns.length}, minmax(196px, 1fr))` }
  const totals = new Map(columns.map((c) => [c.id, lanes.flatMap((l) => l.cells.get(c.id) ?? [])]))
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="px-5 pb-10" style={{ minWidth: columns.length * 208 + 40 }}>
        <div style={gridCols} className="sticky top-0 z-20 grid gap-3 bg-bg/90 py-2.5 backdrop-blur">
          {columns.map((c) => {
            const items = totals.get(c.id) ?? []
            const rem = sum(items.map((w) => w.remaining))
            return (
              <div key={c.id} className="flex items-center gap-2 px-1">
                <span className="text-[12px] font-semibold tracking-wide text-muted uppercase">{c.name}</span>
                <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-medium text-muted tabular-nums">{items.length}</span>
                {rem > 0 && <span className="text-[11px] text-faint tabular-nums">{fmtNum(rem)}h</span>}
              </div>
            )
          })}
        </div>
        <div className="space-y-2.5">
          {lanes.map((lane) => (
            <LaneView
              key={lane.key}
              lane={lane}
              columns={columns}
              meta={meta}
              grid={gridCols}
              flat={groupBy === 'none'}
              crossLaneDrop={groupBy === 'person'}
              iterationPath={iterationPath}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function LaneView({
  lane,
  columns,
  meta,
  grid,
  flat,
  crossLaneDrop,
  iterationPath
}: {
  lane: Lane
  columns: TaskboardColumn[]
  meta: Meta
  grid: React.CSSProperties
  flat: boolean
  crossLaneDrop: boolean
  iterationPath: string
}) {
  const collapsed = useUi((s) => !flat && !!s.collapsed[lane.key])
  const toggle = useUi((s) => s.toggleCollapsed)
  const openItem = useUi((s) => s.openItem)
  const canEdit = useCanEdit()
  const [adding, setAdding] = useState(false)
  const drag = useDrag()
  const update = useUpdateWorkItem()
  const accepts = canEdit && drag.item !== null && (drag.laneKey === lane.key || crossLaneDrop)

  const drop = (col: TaskboardColumn) => {
    const w = drag.item
    useDrag.getState().end()
    if (!w) return
    const changes: FieldChange[] = []
    const labels: string[] = []
    const targetState = col.mappings.find((m) => m.workItemType === w.type)?.state
    if (!targetState) {
      toast({ kind: 'error', message: `A ${w.type} can’t go to “${col.name}”`, detail: 'This column has no state mapping for that type.' })
      return
    }
    if (targetState !== w.state) {
      changes.push({ field: 'System.State', value: targetState, prev: w.state })
      labels.push(`State → ${targetState}`)
    }
    if (crossLaneDrop && drag.laneKey !== lane.key) {
      const who = lane.person ? { displayName: lane.person.name, uniqueName: lane.person.uniqueName, imageUrl: lane.person.imageUrl } : null
      changes.push({ field: 'System.AssignedTo', value: identityValue(who), display: who ?? undefined, prev: identityValue(w.assignedTo), prevDisplay: w.assignedTo })
      labels.push(who ? `Assigned to ${who.displayName}` : 'Unassigned')
    }
    if (changes.length) update.mutate({ id: w.id, rev: w.rev, changes, label: labels.join(', ') })
  }
  const done = lane.cards.filter((w) => stateInfo(meta, w.type, w.state).category === 'Completed').length
  const remaining = sum(lane.cards.map((w) => w.remaining))

  return (
    <section className={cn('group/lane', !flat && 'rounded-xl border border-line bg-surface/60')}>
      {!flat && (
        <div className="flex min-w-0 items-center gap-2 py-2 pr-3 pl-2 [&>*]:shrink-0">
          <button onClick={() => toggle(lane.key)} className="rounded p-0.5 text-faint hover:bg-surface-2 hover:text-fg">
            <ChevronRight size={15} className={cn('transition-transform', !collapsed && 'rotate-90')} />
          </button>
          {lane.parent ? (
            <>
              <TypeIcon meta={meta} type={lane.parent.type} />
              <span className="font-mono text-[11.5px] text-faint tabular-nums">{lane.parent.id}</span>
              <button
                onClick={() => openItem(lane.parent!.id)}
                className="min-w-0 shrink! truncate text-left text-[13px] font-semibold hover:text-accent-fg hover:underline"
                title={lane.parent.title}
              >
                {lane.parent.title}
              </button>
              <StatePill meta={meta} type={lane.parent.type} state={lane.parent.state} />
              {lane.outsideSprint && (
                <span className="rounded bg-amber-500/12 px-1.5 py-px text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
                  Other iteration
                </span>
              )}
              {lane.parent.effort !== undefined && (
                <span className="rounded bg-surface-2 px-1.5 py-px text-[11px] text-muted tabular-nums" title="Effort">
                  {fmtNum(lane.parent.effort)} pts
                </span>
              )}
              <Avatar who={lane.parent.assignedTo} size={20} />
            </>
          ) : lane.person ? (
            <>
              <Avatar who={{ displayName: lane.person.name, uniqueName: lane.person.uniqueName, imageUrl: lane.person.imageUrl }} size={22} />
              <span className="text-[13px] font-semibold">{lane.label}</span>
            </>
          ) : (
            <span className="text-[13px] font-semibold text-muted">{lane.label}</span>
          )}
          <span className="ml-2 flex items-center gap-2 text-[11px] text-faint tabular-nums">
            {lane.cards.length > 0 && (
              <>
                <ProgressBar
                  className="w-16"
                  segments={[
                    { value: done, color: '#22a06b' },
                    { value: lane.cards.length - done, color: 'transparent' }
                  ]}
                />
                {done}/{lane.cards.length}
              </>
            )}
            {remaining > 0 && <span>· {fmtNum(remaining)}h left</span>}
            {lane.cards.length === 0 && <span>No tasks</span>}
          </span>
          {canEdit && lane.parent && !lane.outsideSprint && (
            <button
              onClick={() => (setAdding(true), collapsed && toggle(lane.key))}
              className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-faint opacity-0 group-hover/lane:opacity-100 hover:bg-surface-2 hover:text-fg focus:opacity-100"
              title="Add a task to this item"
            >
              <Plus size={12} /> Task
            </button>
          )}
        </div>
      )}
      {adding && lane.parent && (
        <QuickAddTask parent={lane.parent} meta={meta} iterationPath={iterationPath} onClose={() => setAdding(false)} />
      )}
      {!collapsed && (flat || lane.cards.length > 0) && (
        <div style={grid} className={cn('grid gap-3', !flat && 'px-2 pb-2')}>
          {columns.map((c) => (
            <div
              key={c.id}
              onDragOver={(e) => {
                if (!accepts) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (drag.over !== `${lane.key}|${c.id}`) useDrag.setState({ over: `${lane.key}|${c.id}` })
              }}
              onDrop={(e) => (e.preventDefault(), drop(c))}
              className={cn(
                'min-h-12 space-y-2 rounded-lg transition-colors',
                !flat && 'p-1.5',
                accepts && 'outline-1 outline-dashed outline-line-strong',
                accepts && drag.over === `${lane.key}|${c.id}`
                  ? 'bg-accent-soft outline-2 outline-solid outline-accent'
                  : !flat && 'bg-surface-2/60'
              )}
            >
              {(lane.cells.get(c.id) ?? []).map((w) => (
                <div
                  key={w.id}
                  draggable={canEdit}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', String(w.id))
                    // Deferred so the browser snapshots the card before it fades (timer, not rAF: frames
                    // are paused while a window is occluded).
                    setTimeout(() => useDrag.setState({ item: w, laneKey: lane.key, over: null }))
                  }}
                  onDragEnd={() => useDrag.getState().end()}
                  className={cn(drag.item?.id === w.id && 'opacity-40')}
                >
                  <WorkItemCard w={w} meta={meta} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Board-wide drag state, so every lane can highlight valid drop targets. */
const useDrag = create<{ item: WorkItem | null; laneKey: string | null; over: string | null; end(): void }>()((set) => ({
  item: null,
  laneKey: null,
  over: null,
  end: () => set({ item: null, laneKey: null, over: null })
}))

/** Inline row for typing tasks under a parent in quick succession. Enter adds, Esc closes. */
function QuickAddTask({ parent, meta, iterationPath, onClose }: { parent: WorkItem; meta: Meta; iterationPath: string; onClose(): void }) {
  const create = useCreateWorkItem()
  const [title, setTitle] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const type = meta.config.taskBacklog.defaultWorkItemType?.name ?? meta.config.taskBacklog.workItemTypes[0]?.name
  const submit = () => {
    const t = title.trim()
    if (!t || !type) return
    create.mutate({
      type,
      parentId: parent.id,
      fields: { 'System.Title': t, 'System.IterationPath': iterationPath, 'System.AreaPath': parent.areaPath }
    })
    setTitle('')
    ref.current?.focus()
  }
  return (
    <div className="mx-2 mb-2 flex items-center gap-2 rounded-lg border border-accent bg-surface px-2.5 py-1.5 ring-3 ring-[var(--ring)]">
      {type && <TypeIcon meta={meta} type={type} />}
      <input
        ref={ref}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.preventDefault(), submit())
          if (e.key === 'Escape') (e.stopPropagation(), onClose())
        }}
        onBlur={() => !title.trim() && onClose()}
        placeholder={`New ${type ?? 'task'} under #${parent.id} — Enter to add, Esc to close`}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none select-text placeholder:text-faint"
      />
      {create.isPending && <span className="text-[11px] text-faint">Adding…</span>}
    </div>
  )
}

function BoardSkeleton() {
  return (
    <div className="space-y-3 p-5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-line p-3">
          <Skeleton className="mb-3 h-4 w-80" />
          <div className="grid grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((j) => (
              <Skeleton key={j} className={cn('h-20', (i + j) % 3 === 0 && 'opacity-0')} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

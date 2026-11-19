import { createContext, memo, useContext, useMemo, useState } from 'react'
import { create } from 'zustand'
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, ChevronRight, Ellipsis, GripVertical, ListTree, Plus, RefreshCw } from 'lucide-react'
import { FilterBar } from '@/components/FilterBar'
import { Avatar, Button, EmptyState, ErrorState, Kbd, Popover, Skeleton, StatePill, Tag, TypeIcon } from '@/components/ui'
import { isDone, matchesFilters, type Meta } from '@/lib/model'
import { useCreateWorkItem, useReorderBacklog } from '@/lib/mutations'
import { currentPosition, moveRelative, moveStep, moveToEdge, type Move } from '@/lib/reorder'
import { useBacklog, useChildren, useIterations, useMe, useMeta, useTeamDefaults } from '@/lib/queries'
import { isFiltering, useCanEdit, useUi } from '@/lib/store'
import type { WorkItem } from '@/lib/types'
import { cn, fmtNum, sum } from '@/lib/utils'

interface Node {
  item: WorkItem
  /** Ancestors are shown for context only; they're not part of this backlog level. */
  context: boolean
  children: Node[]
}

const GRID = 'grid grid-cols-[minmax(0,1fr)_120px_150px_64px_150px] items-center gap-3'

type MoveKind = { kind: 'relative'; target: number; where: 'before' | 'after' } | { kind: 'edge'; edge: 'top' | 'bottom' } | { kind: 'step'; delta: -1 | 1 }

/** Siblings under one expanded parent row, in backlog order — the scope children are reordered in. */
interface ChildScope {
  ids: number[]
  parentId: number
}

/** Reordering API shared by all rows; `null` when the backlog can't be reordered. */
const ReorderCtx = createContext<{
  /** `scope` is given for children of an expanded row; otherwise the backlog level (or Parents-view siblings). */
  move(w: WorkItem, how: MoveKind, scope?: ChildScope): void
  scopeKey(w: WorkItem, scope?: ChildScope): string
} | null>(null)

/** Row being dragged and the current drop indicator. */
const useRowDrag = create<{ item: WorkItem | null; scope: string | null; over: { id: number; where: 'before' | 'after' } | null }>()(
  () => ({ item: null, scope: null, over: null })
)
const endDrag = () => useRowDrag.setState({ item: null, scope: null, over: null })

export function Backlog() {
  const ui = useUi()
  const canEdit = useCanEdit()
  const meta = useMeta()
  const me = useMe().data
  const level = meta.data?.levels.find((l) => l.id === ui.backlogLevelId)
  const levelType = level?.defaultWorkItemType?.name ?? level?.workItemTypes[0]?.name
  const backlog = useBacklog(ui.backlogLevelId, meta.data, ui.backlogShowParents)
  const reorder = useReorderBacklog()

  const { roots, visible, effort } = useMemo(() => {
    if (!backlog.data || !meta.data) return { roots: [], visible: [], effort: 0 }
    const visible = backlog.data.items.filter(
      (w) => (ui.backlogShowCompleted || !isDone(meta.data!, w)) && matchesFilters(w, ui.filters, me?.id)
    )
    // ADO returns the level in backlog order; keep it.
    const rank = new Map(backlog.data.ids.map((id, i) => [id, i]))
    visible.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
    const effort = sum(visible.map((w) => w.effort))
    if (!ui.backlogShowParents) return { roots: visible.map((item) => ({ item, context: false, children: [] })), visible, effort }

    const byId = new Map<number, Node>()
    const ancestors = new Map(backlog.data.ancestors.map((a) => [a.id, a]))
    const roots: Node[] = []
    const nodeFor = (w: WorkItem, context: boolean): Node => {
      let n = byId.get(w.id)
      if (n) return n
      n = { item: w, context, children: [] }
      byId.set(w.id, n)
      const parent = w.parentId !== undefined ? ancestors.get(w.parentId) : undefined
      if (parent) nodeFor(parent, true).children.push(n)
      else roots.push(n)
      return n
    }
    visible.forEach((w) => nodeFor(w, false))
    return { roots, visible, effort }
  }, [backlog.data, meta.data, ui.filters, ui.backlogShowParents, ui.backlogShowCompleted, me?.id])

  const reorderApi = useMemo(() => {
    if (!canEdit || !backlog.data) return null
    const order = backlog.data.ids
    const byId = new Map(backlog.data.items.map((w) => [w.id, w]))
    const parents = ui.backlogShowParents
    // In the Parents view items move among their siblings only; otherwise across the whole level.
    const scopeKey = (w: WorkItem, child?: ChildScope) => (child ? `c:${child.parentId}` : parents ? `p:${w.parentId ?? 0}` : 'all')
    const scope = (w: WorkItem) => (parents ? order.filter((id) => byId.get(id)?.parentId === w.parentId) : order)
    const visibleScope = (w: WorkItem) => visible.filter((v) => !parents || v.parentId === w.parentId).map((v) => v.id)
    return {
      scopeKey,
      move(w: WorkItem, how: MoveKind, child?: ChildScope) {
        const sc = child ? child.ids : scope(w)
        const vis = child ? child.ids : visibleScope(w)
        const parentId = child ? child.parentId : parents ? w.parentId : undefined
        let m: Move | null = null
        let label = ''
        if (how.kind === 'relative') {
          m = moveRelative(sc, w.id, how.target, how.where, parentId)
          label = `Moved ${how.where} #${how.target}`
        } else if (how.kind === 'edge') {
          m = moveToEdge(sc, w.id, how.edge, parentId)
          label = how.edge === 'top' ? 'Moved to top' : 'Moved to bottom'
        } else {
          m = moveStep(sc, vis, w.id, how.delta, parentId)
          label = how.delta < 0 ? 'Moved up' : 'Moved down'
        }
        if (!m) return
        reorder.mutate({ move: m, undo: currentPosition(sc, w.id, parentId) ?? undefined, label })
        // Reordering re-inserts the row's DOM node, which drops keyboard focus; restore it.
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(`[data-row="${w.id}"]`)
          el?.focus({ preventScroll: true })
          el?.scrollIntoView({ block: 'nearest' })
        })
      }
    }
  }, [canEdit, backlog.data, ui.backlogShowParents, visible, reorder])

  if (meta.error || backlog.error) return <ErrorState error={meta.error ?? backlog.error} onRetry={() => backlog.refetch()} />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-end gap-4 px-5 pt-4 pb-3">
        <div>
          <div className="text-[12px] text-faint">Backlog</div>
          <h1 className="mt-1 flex items-center gap-2 text-[20px] font-semibold tracking-tight">
            {level && meta.data && <TypeIcon meta={meta.data} type={level.defaultWorkItemType?.name ?? level.workItemTypes[0]?.name} size={18} />}
            {level?.name ?? 'Backlog'}
          </h1>
        </div>
        <div className="flex-1" />
        {backlog.data && (
          <div className="pb-1 text-[12px] text-faint tabular-nums">
            {visible.length} items{effort > 0 && ` · ${fmtNum(effort)} pts`}
          </div>
        )}
      </header>
      <div className="flex items-center gap-2 border-b border-line px-5 py-2">
        <FilterBar items={backlog.data?.items ?? []} meta={meta.data} />
        <div className="flex-1" />
        <Button active={ui.backlogShowParents} onClick={() => ui.setBacklogShowParents(!ui.backlogShowParents)}>
          <ListTree size={13} /> Parents
        </Button>
        <Button active={ui.backlogShowCompleted} onClick={() => ui.setBacklogShowCompleted(!ui.backlogShowCompleted)}>
          Completed
        </Button>
        {canEdit && (
          <Button variant="outline" onClick={() => ui.openCreate({ type: levelType })} title="New work item  (C)">
            <Plus size={13} /> New
          </Button>
        )}
        <Button onClick={() => backlog.refetch()} title="Refresh  (R)">
          <RefreshCw size={13} className={cn(backlog.isFetching && 'animate-spin')} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className={cn(GRID, 'sticky top-0 z-10 border-b border-line bg-bg/90 px-5 py-2 text-[11px] font-semibold tracking-wide text-faint uppercase backdrop-blur')}>
          <span className="pl-12">Title</span>
          <span>State</span>
          <span>Iteration</span>
          <span className="text-right">Effort</span>
          <span>Assigned</span>
        </div>
        {canEdit && meta.data && level && <QuickAdd meta={meta.data} types={level.workItemTypes.map((t) => t.name)} defaultType={levelType} />}
        {backlog.isPending || !meta.data ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className="h-7" />
            ))}
          </div>
        ) : roots.length === 0 ? (
          <EmptyState title={isFiltering(ui.filters) ? 'Nothing matches your filters' : 'The backlog is empty'} />
        ) : (
          <ReorderCtx.Provider value={reorderApi}>
            <div className="pb-10">
              {roots.map((n, i) => (
                <Row key={n.item.id} node={n} depth={0} meta={meta.data!} index={ui.backlogShowParents ? undefined : i + 1} reorderable={!n.context} />
              ))}
            </div>
          </ReorderCtx.Provider>
        )}
      </div>
    </div>
  )
}

const Row = memo(function Row({
  node,
  depth,
  meta,
  index,
  reorderable,
  childScope
}: {
  node: Node
  depth: number
  meta: Meta
  index?: number
  /** Items of this backlog level (not ancestors shown for context). */
  reorderable?: boolean
  /** Set for children of an expanded row: they're reordered among these siblings. */
  childScope?: ChildScope
}) {
  const { item: w, context } = node
  const reorderCtx = useContext(ReorderCtx)
  const canMove = (!!reorderable || !!childScope) && !!reorderCtx
  const scope = reorderCtx?.scopeKey(w, childScope)
  const dragging = useRowDrag((s) => s.item?.id === w.id)
  const indicator = useRowDrag((s) => (s.over?.id === w.id ? s.over.where : null))
  // Separate keys: context rows are expanded by default, item rows collapsed — sharing one key would
  // make expanding a Feature on its own backlog collapse it as a parent in the Stories Parents view.
  const key = context ? `backlog:ctx:${w.id}` : `backlog:${w.id}`
  // Context rows (ancestors) start expanded; real rows lazily load their children when expanded.
  const expanded = useUi((s) => (context ? !s.collapsed[key] : !!s.collapsed[key]))
  const toggle = useUi((s) => s.toggleCollapsed)
  const openItem = useUi((s) => s.openItem)
  const selected = useUi((s) => s.drawerId === w.id)
  const iterations = useIterations().data
  const children = useChildren(w.id, !context && expanded, meta)
  const iterationName = iterations?.find((i) => i.path === w.iterationPath)?.name ?? w.iterationPath.split('\\').slice(1).join(' / ')

  const kids: Node[] = context ? node.children : (children.data ?? []).map((item) => ({ item, context: false, children: [] }))
  const kidScope = useMemo<ChildScope | undefined>(
    () => (context || !children.data ? undefined : { ids: children.data.map((k) => k.id), parentId: w.id }),
    [context, children.data, w.id]
  )

  return (
    <>
      <div
        data-row={w.id}
        tabIndex={canMove ? 0 : undefined}
        onClick={() => openItem(w.id)}
        draggable={canMove}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', String(w.id))
          // Deferred so the browser snapshots the row before it fades. A timer, not rAF: animation
          // frames are paused while a window is occluded, which would leave the drag state unset.
          setTimeout(() => useRowDrag.setState({ item: w, scope, over: null }))
        }}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          const d = useRowDrag.getState()
          if (!canMove || !d.item || d.item.id === w.id || d.scope !== scope) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          const r = e.currentTarget.getBoundingClientRect()
          const where = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
          if (d.over?.id !== w.id || d.over.where !== where) useRowDrag.setState({ over: { id: w.id, where } })
        }}
        onDrop={(e) => {
          const d = useRowDrag.getState()
          endDrag()
          if (!canMove || !d.item || !d.over || d.item.id === w.id || d.scope !== scope) return
          e.preventDefault()
          reorderCtx!.move(d.item, { kind: 'relative', target: w.id, where: d.over.where }, childScope)
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter') return openItem(w.id)
          if (!canMove || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
          e.preventDefault()
          const up = e.key === 'ArrowUp'
          reorderCtx!.move(w, e.shiftKey ? { kind: 'edge', edge: up ? 'top' : 'bottom' } : { kind: 'step', delta: up ? -1 : 1 }, childScope)
        }}
        className={cn(
          GRID,
          'group relative cursor-default border-b border-line/60 px-5 py-1.5 transition-colors outline-none hover:bg-surface',
          'focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-inset',
          selected && 'bg-accent-soft hover:bg-accent-soft',
          context && 'bg-surface-2/40',
          dragging && 'opacity-40'
        )}
      >
        {indicator && (
          <span
            className={cn(
              'pointer-events-none absolute inset-x-3 z-10 h-0.5 rounded-full bg-accent',
              indicator === 'before' ? '-top-px' : '-bottom-px'
            )}
          />
        )}
        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 20 }}>
          <span className="w-6 text-right font-mono text-[10.5px] text-faint tabular-nums">
            {canMove ? (
              <>
                <span className="group-hover:hidden">{index ?? ''}</span>
                <GripVertical size={14} className="ml-auto hidden cursor-grab text-faint group-hover:block" aria-label="Drag to reorder" />
              </>
            ) : (
              (index ?? '')
            )}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggle(key)
            }}
            className="rounded p-0.5 text-faint opacity-60 hover:bg-surface-3 hover:text-fg group-hover:opacity-100"
          >
            {children.isFetching ? (
              <RefreshCw size={13} className="animate-spin" />
            ) : (
              <ChevronRight size={14} className={cn('transition-transform', expanded && 'rotate-90')} />
            )}
          </button>
          <TypeIcon meta={meta} type={w.type} />
          <span className="font-mono text-[11px] text-faint tabular-nums">{w.id}</span>
          <span className={cn('truncate text-[13px]', context ? 'font-semibold text-muted' : 'font-medium')}>{w.title}</span>
          <span className="hidden shrink-0 gap-1 xl:flex">
            {w.tags.slice(0, 2).map((t) => (
              <Tag key={t} name={t} />
            ))}
          </span>
          {canMove && <RowMenu w={w} scope={childScope} />}
        </div>
        <span>
          <StatePill meta={meta} type={w.type} state={w.state} />
        </span>
        <span className="truncate text-[12px] text-muted">{iterationName}</span>
        <span className="text-right text-[12px] text-muted tabular-nums">{w.effort !== undefined ? fmtNum(w.effort) : ''}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          {(!context || w.assignedTo) && <Avatar who={w.assignedTo} size={20} />}
          <span className="truncate">{w.assignedTo?.displayName ?? ''}</span>
        </span>
      </div>
      {expanded &&
        kids.map((k) => (
          <Row key={k.item.id} node={k} depth={depth + 1} meta={meta} reorderable={context && !k.context} childScope={kidScope} />
        ))}
      {expanded && !context && children.data?.length === 0 && (
        <div className="border-b border-line/60 py-1.5 text-[12px] text-faint" style={{ paddingLeft: 20 + (depth + 1) * 20 + 76 }}>
          No child items
        </div>
      )}
    </>
  )
})

function RowMenu({ w, scope }: { w: WorkItem; scope?: ChildScope }) {
  const ctx = useContext(ReorderCtx)!
  const items: { label: string; how: MoveKind; icon: React.ReactNode; keys: string }[] = [
    { label: 'Move to top', how: { kind: 'edge', edge: 'top' }, icon: <ArrowUpToLine size={13} />, keys: '⌥⇧↑' },
    { label: 'Move up', how: { kind: 'step', delta: -1 }, icon: <ArrowUp size={13} />, keys: '⌥↑' },
    { label: 'Move down', how: { kind: 'step', delta: 1 }, icon: <ArrowDown size={13} />, keys: '⌥↓' },
    { label: 'Move to bottom', how: { kind: 'edge', edge: 'bottom' }, icon: <ArrowDownToLine size={13} />, keys: '⌥⇧↓' }
  ]
  return (
    <span className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
      <Popover
        width={210}
        align="end"
        trigger={(open, toggle) => (
          <button
            title="Reorder"
            onClick={toggle}
            className={cn('rounded p-0.5 text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-fg', open && 'opacity-100')}
          >
            <Ellipsis size={14} />
          </button>
        )}
      >
        {(close) => (
          <div className="p-1" onClick={(e) => e.stopPropagation()}>
            {items.map((it) => (
              <button
                key={it.label}
                onClick={() => (close(), ctx.move(w, it.how, scope))}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-surface-2"
              >
                <span className="text-faint">{it.icon}</span>
                <span className="flex-1">{it.label}</span>
                <Kbd>{it.keys}</Kbd>
              </button>
            ))}
          </div>
        )}
      </Popover>
    </span>
  )
}

/** Top-of-backlog row: type a title, pick the type, Enter creates it in the team's backlog iteration. */
function QuickAdd({ meta, types, defaultType }: { meta: Meta; types: string[]; defaultType?: string }) {
  const create = useCreateWorkItem()
  const defaults = useTeamDefaults().data
  const [title, setTitle] = useState('')
  const [type, setType] = useState(defaultType ?? types[0])
  const current = types.includes(type) ? type : (defaultType ?? types[0])
  const submit = () => {
    const t = title.trim()
    if (!t) return
    create.mutate({
      type: current,
      fields: { 'System.Title': t, 'System.IterationPath': defaults?.backlogIterationPath, 'System.AreaPath': defaults?.areaPath }
    })
    setTitle('')
  }
  return (
    <div className="flex items-center gap-2 border-b border-line/60 px-5 py-1.5">
      <span className="w-6" />
      <Plus size={14} className="text-faint" />
      <select
        value={current}
        onChange={(e) => setType(e.target.value)}
        className="rounded bg-transparent text-[12px] text-muted outline-none hover:text-fg"
        title="Type"
      >
        {types.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <TypeIcon meta={meta} type={current} />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.preventDefault(), submit())
          if (e.key === 'Escape') (setTitle(''), e.currentTarget.blur())
        }}
        placeholder={`Add a ${current} — type a title and press Enter`}
        className="min-w-0 flex-1 bg-transparent py-0.5 text-[13px] outline-none select-text placeholder:text-faint"
      />
      {create.isPending && <span className="text-[11px] text-faint">Adding…</span>}
    </div>
  )
}

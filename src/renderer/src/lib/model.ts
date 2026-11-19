import type { FieldMap } from './api'
import type {
  BacklogConfiguration,
  BacklogLevel,
  StateCategory,
  TaskboardColumn,
  TaskboardWorkItemColumn,
  WorkItem,
  WorkItemType
} from './types'
import type { Filters, GroupBy } from './store'

/** Process metadata for the configured project/team — everything the UI needs to stay process-agnostic. */
export interface Meta {
  types: Map<string, WorkItemType>
  config: BacklogConfiguration
  fieldMap: FieldMap
  fields: Set<string>
  /** Backlog levels top-down: Epics, Features, …, requirement level. */
  levels: BacklogLevel[]
  portfolioTypes: Set<string>
  requirementTypes: Set<string>
  taskTypes: Set<string>
}

export function buildMeta(types: WorkItemType[], config: BacklogConfiguration, fields: Set<string>): Meta {
  const tf = config.backlogFields?.typeFields ?? {}
  const names = (l: BacklogLevel) => l.workItemTypes.map((t) => t.name)
  return {
    types: new Map(types.map((t) => [t.name, t])),
    config,
    fields,
    fieldMap: { order: tf.Order, effort: tf.Effort, remaining: tf.RemainingWork, activity: tf.Activity },
    levels: [...[...config.portfolioBacklogs].sort((a, b) => b.rank - a.rank), config.requirementBacklog],
    portfolioTypes: new Set(config.portfolioBacklogs.flatMap(names)),
    requirementTypes: new Set(names(config.requirementBacklog)),
    taskTypes: new Set(names(config.taskBacklog))
  }
}

const CATEGORY_ORDER: StateCategory[] = ['Proposed', 'InProgress', 'Resolved', 'Completed', 'Removed']

export function stateInfo(meta: Meta, type: string, state: string) {
  const s = meta.types.get(type)?.states.find((x) => x.name === state)
  return { color: s ? `#${s.color}` : '#8a8f98', category: (s?.category ?? 'Proposed') as StateCategory }
}

/** True when the work item type has the field (falls back to true if the API didn't list fields). */
export function typeHasField(meta: Meta, type: string, field?: string): boolean {
  if (!field) return false
  const fields = meta.types.get(type)?.fields
  return !fields || fields.some((f) => f.referenceName === field)
}

export const typeColor = (meta: Meta, type: string) => `#${meta.types.get(type)?.color ?? '8a8f98'}`

export const isDone = (meta: Meta, w: WorkItem) => {
  const c = stateInfo(meta, w.type, w.state).category
  return c === 'Completed' || c === 'Removed'
}

/** Cards on the sprint board are task-level items (and bugs when the team tracks bugs with tasks). */
export function isTaskLevel(meta: Meta, w: WorkItem): boolean {
  if (meta.taskTypes.has(w.type)) return true
  if (meta.requirementTypes.has(w.type) || meta.portfolioTypes.has(w.type)) return false
  return meta.config.bugsBehavior === 'asTasks'
}

// ---- filtering --------------------------------------------------------------

export function matchesFilters(w: WorkItem, f: Filters, me?: string): boolean {
  if (f.text) {
    const q = f.text.toLowerCase()
    const hay = `${w.id} ${w.title} ${w.tags.join(' ')} ${w.assignedTo?.displayName ?? ''}`.toLowerCase()
    if (!q.split(/\s+/).every((t) => hay.includes(t.replace(/^#/, '')))) return false
  }
  const who = w.assignedTo?.uniqueName ?? '__unassigned'
  if (f.mine && w.assignedTo?.id !== me) return false
  if (f.assignees.length && !f.assignees.includes(who)) return false
  if (f.types.length && !f.types.includes(w.type)) return false
  if (f.tags.length && !f.tags.some((t) => w.tags.includes(t))) return false
  return true
}

// ---- sprint board -----------------------------------------------------------

export interface Lane {
  key: string
  /** Parent work item when grouping by parent; undefined for "unparented" and person lanes. */
  parent?: WorkItem
  person?: { name: string; uniqueName?: string; imageUrl?: string }
  label: string
  cells: Map<string, WorkItem[]>
  cards: WorkItem[]
  outsideSprint?: boolean
}

export function deriveColumns(meta: Meta, items: WorkItem[]): TaskboardColumn[] {
  const taskType = [...meta.taskTypes][0] ?? items.find((w) => isTaskLevel(meta, w))?.type
  const states = (meta.types.get(taskType ?? '')?.states ?? [])
    .filter((s) => s.category !== 'Removed')
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
  return states.map((s, i) => ({
    id: s.name,
    name: s.name,
    order: i,
    mappings: [...meta.types.values()].flatMap((t) =>
      t.states.some((x) => x.name === s.name) ? [{ workItemType: t.name, state: s.name }] : []
    )
  }))
}

export function columnFor(
  meta: Meta,
  w: WorkItem,
  columns: TaskboardColumn[],
  placed: Map<number, TaskboardWorkItemColumn>
): string | undefined {
  const p = placed.get(w.id)
  if (p && columns.some((c) => c.id === p.columnId)) return p.columnId
  const mapped = columns.find((c) => c.mappings.some((m) => m.workItemType === w.type && m.state === w.state))
  if (mapped) return mapped.id
  const byName = columns.find((c) => c.name.toLowerCase() === w.state.toLowerCase())
  if (byName) return byName.id
  // Fall back on state category: proposed → first column, completed → last, otherwise a middle one.
  const cat = stateInfo(meta, w.type, w.state).category
  if (cat === 'Removed') return undefined
  if (cat === 'Proposed') return columns[0]?.id
  if (cat === 'Completed') return columns.at(-1)?.id
  return columns[Math.min(1, columns.length - 1)]?.id
}

const byOrder = (a: WorkItem, b: WorkItem) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.id - b.id

export function buildLanes(args: {
  meta: Meta
  items: WorkItem[]
  outsideParents: WorkItem[]
  columns: TaskboardColumn[]
  placed: Map<number, TaskboardWorkItemColumn>
  groupBy: GroupBy
  filter: (w: WorkItem) => boolean
  filtering: boolean
}): Lane[] {
  const { meta, items, outsideParents, columns, placed, groupBy, filter, filtering } = args
  const cards = items.filter((w) => isTaskLevel(meta, w) && !meta.portfolioTypes.has(w.type))
  const parents = items.filter((w) => !isTaskLevel(meta, w) && !meta.portfolioTypes.has(w.type)).sort(byOrder)

  const emptyCells = () => new Map(columns.map((c) => [c.id, [] as WorkItem[]]))
  const place = (lane: Lane, w: WorkItem) => {
    const col = columnFor(meta, w, columns, placed)
    if (col) lane.cells.get(col)?.push(w)
    lane.cards.push(w)
  }

  if (groupBy === 'person') {
    const lanes = new Map<string, Lane>()
    for (const w of cards.filter(filter).sort(byOrder)) {
      const key = w.assignedTo?.uniqueName ?? '__unassigned'
      if (!lanes.has(key)) {
        lanes.set(key, {
          key: `person:${key}`,
          label: w.assignedTo?.displayName ?? 'Unassigned',
          person: w.assignedTo
            ? { name: w.assignedTo.displayName, uniqueName: w.assignedTo.uniqueName, imageUrl: w.assignedTo.imageUrl }
            : undefined,
          cells: emptyCells(),
          cards: []
        })
      }
      place(lanes.get(key)!, w)
    }
    return [...lanes.values()].sort((a, b) =>
      !a.person ? 1 : !b.person ? -1 : a.label.localeCompare(b.label)
    )
  }

  if (groupBy === 'none') {
    const lane: Lane = { key: 'all', label: 'All work', cells: emptyCells(), cards: [] }
    cards.filter(filter).sort(byOrder).forEach((w) => place(lane, w))
    return [lane]
  }

  const lanes: Lane[] = []
  const laneOf = new Map<number, Lane>()
  for (const p of [...parents, ...outsideParents.sort(byOrder)]) {
    const lane: Lane = {
      key: `parent:${p.id}`,
      parent: p,
      label: p.title,
      cells: emptyCells(),
      cards: [],
      outsideSprint: !parents.includes(p)
    }
    lanes.push(lane)
    laneOf.set(p.id, lane)
  }
  const unparented: Lane = { key: 'unparented', label: 'Unparented', cells: emptyCells(), cards: [] }
  for (const w of cards.sort(byOrder)) {
    if (!filter(w)) continue
    place((w.parentId !== undefined && laneOf.get(w.parentId)) || unparented, w)
  }
  const visible = lanes.filter((l) => !filtering || l.cards.length > 0 || filter(l.parent!))
  if (unparented.cards.length) visible.push(unparented)
  return visible
}

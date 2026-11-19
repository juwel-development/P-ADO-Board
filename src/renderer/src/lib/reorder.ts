// Backlog reordering, expressed the way the ADO API wants it: "put these ids between previousId and
// nextId" (0 = no neighbour on that side). Pure functions so they can be tested in isolation.
//
// `order` is always the *full* order of the scope being reordered (the whole backlog level, or the
// siblings under one parent), never the filtered view — so "drop above B" means "directly before B"
// even when hidden items sit between B and the row visibly above it.

export interface Move {
  ids: number[]
  previousId: number
  nextId: number
  /** Set when reordering within a parent (the Parents view). */
  parentId?: number
}

const without = (order: number[], id: number) => order.filter((x) => x !== id)

/** Neighbours `id` has now — the move that restores this position later (undo). */
export function currentPosition(order: number[], id: number, parentId?: number): Move | null {
  const i = order.indexOf(id)
  if (i < 0) return null
  return { ids: [id], previousId: order[i - 1] ?? 0, nextId: order[i + 1] ?? 0, parentId }
}

const isNoop = (order: number[], m: Move) => {
  const cur = currentPosition(order, m.ids[0])
  return !!cur && cur.previousId === m.previousId && cur.nextId === m.nextId
}

/** Move `id` directly before or after `target`. */
export function moveRelative(order: number[], id: number, target: number, where: 'before' | 'after', parentId?: number): Move | null {
  if (id === target) return null
  const rest = without(order, id)
  const t = rest.indexOf(target)
  if (t < 0 || !order.includes(id)) return null
  const m: Move =
    where === 'before'
      ? { ids: [id], previousId: rest[t - 1] ?? 0, nextId: target, parentId }
      : { ids: [id], previousId: target, nextId: rest[t + 1] ?? 0, parentId }
  return isNoop(order, m) ? null : m
}

export function moveToEdge(order: number[], id: number, edge: 'top' | 'bottom', parentId?: number): Move | null {
  const rest = without(order, id)
  if (!order.includes(id) || rest.length === 0) return null
  const m: Move =
    edge === 'top' ? { ids: [id], previousId: 0, nextId: rest[0], parentId } : { ids: [id], previousId: rest.at(-1)!, nextId: 0, parentId }
  return isNoop(order, m) ? null : m
}

/** One step up/down among the *visible* rows of the scope (skips filtered-out items). */
export function moveStep(order: number[], visible: number[], id: number, delta: -1 | 1, parentId?: number): Move | null {
  const v = visible.indexOf(id)
  const target = visible[v + delta]
  if (v < 0 || target === undefined) return null
  return moveRelative(order, id, target, delta < 0 ? 'before' : 'after', parentId)
}

/** The full backlog order after applying `m` locally (optimistic update). */
export function applyMove(all: number[], m: Move): number[] {
  const rest = all.filter((x) => !m.ids.includes(x))
  let at = m.previousId ? rest.indexOf(m.previousId) + 1 : m.nextId ? rest.indexOf(m.nextId) : rest.length
  if (m.previousId && at === 0) at = m.nextId && rest.includes(m.nextId) ? rest.indexOf(m.nextId) : rest.length
  return [...rest.slice(0, at), ...m.ids, ...rest.slice(at)]
}

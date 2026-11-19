import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Connection } from '@shared/ipc'
import * as api from './api'
import type { FieldMap, PatchOp, RawWorkItem } from './api'
import { useMeta } from './queries'
import { applyMove, type Move } from './reorder'
import { useUi } from './store'
import { toast } from './toasts'
import type { Comment, Identity, WorkItem, WorkItemDetail } from './types'

/**
 * A single field change. `value` is what goes over the wire; `display` (optional) is what the UI
 * caches optimistically, e.g. an Identity object for System.AssignedTo where ADO expects a string.
 */
export interface FieldChange {
  field: string
  value: unknown
  display?: unknown
  /** Previous wire value, used to build the undo and to decide between replace/remove. */
  prev?: unknown
  prevDisplay?: unknown
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === ''

export function changesToOps(changes: FieldChange[], rev?: number): PatchOp[] {
  const ops: PatchOp[] = rev !== undefined ? [{ op: 'test', path: '/rev', value: rev }] : []
  for (const c of changes) {
    if (isEmpty(c.value)) {
      if (!isEmpty(c.prev)) ops.push({ op: 'remove', path: `/fields/${c.field}` })
    } else {
      ops.push({ op: 'add', path: `/fields/${c.field}`, value: c.value })
    }
  }
  return ops
}

// ---- cache helpers ----------------------------------------------------------------

/** Rebuilds the raw field map of a normalized item, so changes can be re-normalized. */
function toRaw(w: WorkItem, fm: FieldMap): RawWorkItem {
  const f: Record<string, unknown> = {
    'System.WorkItemType': w.type,
    'System.Title': w.title,
    'System.State': w.state,
    'System.AssignedTo': w.assignedTo,
    'System.Tags': w.tags.join('; '),
    'System.Parent': w.parentId,
    'System.IterationPath': w.iterationPath,
    'System.AreaPath': w.areaPath,
    'System.ChangedDate': w.changedDate,
    'System.CreatedDate': w.createdDate,
    'Microsoft.VSTS.Common.Priority': w.priority,
    'Microsoft.VSTS.Scheduling.CompletedWork': w.completed
  }
  if (fm.order) f[fm.order] = w.order
  if (fm.effort) f[fm.effort] = w.effort
  if (fm.remaining) f[fm.remaining] = w.remaining
  if (fm.activity) f[fm.activity] = w.activity
  return { id: w.id, rev: w.rev, fields: f }
}

function applyToItem(w: WorkItem, changes: FieldChange[], fm: FieldMap): WorkItem {
  const raw = toRaw(w, fm)
  for (const c of changes) raw.fields[c.field] = isEmpty(c.value) ? undefined : (c.display ?? c.value)
  return api.normalize(raw, fm)
}

type Lists = { items?: WorkItem[]; outsideParents?: WorkItem[]; ancestors?: WorkItem[] }

/** Applies `fn` to every cached copy of work item `id` (sprint, backlog, children, related lists). */
function mapCachedItem(qc: QueryClient, id: number, fn: (w: WorkItem) => WorkItem) {
  const swap = (list?: WorkItem[]) => list?.map((w) => (w.id === id ? fn(w) : w))
  for (const q of qc.getQueryCache().getAll()) {
    const data = q.state.data as Lists | WorkItem[] | undefined
    if (!data || typeof data !== 'object') continue
    if (Array.isArray(data)) {
      if (data.some((w) => w?.id === id && 'title' in w)) qc.setQueryData(q.queryKey, swap(data))
    } else if (data.items || data.outsideParents || data.ancestors) {
      if ([data.items, data.outsideParents, data.ancestors].some((l) => l?.some((w) => w.id === id))) {
        qc.setQueryData(q.queryKey, {
          ...data,
          items: swap(data.items),
          outsideParents: swap(data.outsideParents),
          ancestors: swap(data.ancestors)
        })
      }
    }
  }
}

const isDetailOf = (key: readonly unknown[], id: number) => key[3] === 'item' && key[4] === id

function snapshot(qc: QueryClient) {
  return qc.getQueryCache().getAll().map((q) => [q.queryKey, q.state.data] as const)
}

function restore(qc: QueryClient, snap: ReturnType<typeof snapshot>) {
  for (const [k, d] of snap) qc.setQueryData(k, d)
}

const describe = (err: unknown) => {
  const e = err as api.AdoError
  if (e?.status === 412 || e?.status === 409 || /\btest\b.*\brev\b|TF26071/i.test(e?.message ?? '')) {
    return 'Someone changed this item in Azure DevOps meanwhile. It was reloaded — please try again.'
  }
  return e?.message ?? String(err)
}

// ---- update -----------------------------------------------------------------------

export interface UpdateInput {
  id: number
  rev?: number
  changes: FieldChange[]
  /** Extra JSON-patch ops (relations, multilineFieldsFormat). */
  extraOps?: PatchOp[]
  /** Short description for the toast, e.g. "State → Active". */
  label: string
  undoable?: boolean
}

export function useUpdateWorkItem() {
  const qc = useQueryClient()
  const meta = useMeta().data
  const connection = useUi((s) => s.connection)

  return useMutation({
    mutationFn: async (input: UpdateInput) => {
      const ops = [...changesToOps(input.changes, input.rev), ...(input.extraOps ?? [])]
      if (ops.every((o) => o.op === 'test')) return null
      return api.updateWorkItem(connection!, input.id, ops)
    },
    onMutate: (input) => {
      const snap = snapshot(qc)
      if (meta) mapCachedItem(qc, input.id, (w) => applyToItem(w, input.changes, meta.fieldMap))
      for (const q of qc.getQueryCache().findAll({ predicate: (q) => isDetailOf(q.queryKey, input.id) })) {
        const d = q.state.data as WorkItemDetail | undefined
        if (!d) continue
        const fields = { ...d.fields }
        for (const c of input.changes) fields[c.field] = isEmpty(c.value) ? undefined : (c.display ?? c.value)
        qc.setQueryData(q.queryKey, { ...d, fields })
      }
      return { snap }
    },
    onError: (err, input, ctx) => {
      if (ctx) restore(qc, ctx.snap)
      toast({ kind: 'error', message: `Couldn’t update #${input.id}`, detail: describe(err) })
      void qc.invalidateQueries({ predicate: (q) => isDetailOf(q.queryKey, input.id) })
    },
    onSuccess: (res, input, ctx) => {
      if (!res) return
      if (res.dryRun) {
        if (ctx) restore(qc, ctx.snap)
        toast({ kind: 'info', message: `Validated: ${input.label}`, detail: 'Azure DevOps accepted the change — nothing was saved (validate mode).' })
        return
      }
      if (meta) {
        const fresh = api.normalize(res.data, meta.fieldMap)
        mapCachedItem(qc, input.id, () => fresh)
      }
      void qc.invalidateQueries({ predicate: (q) => isDetailOf(q.queryKey, input.id) })
      const undo = input.undoable !== false
      toast({
        kind: 'success',
        message: `#${input.id} · ${input.label}`,
        action: undo
          ? {
              label: 'Undo',
              run: () =>
                updateRef.current?.({
                  id: input.id,
                  rev: res.data.rev,
                  label: `Undid ${input.label}`,
                  undoable: false,
                  changes: input.changes.map((c) => ({ field: c.field, value: c.prev, display: c.prevDisplay ?? c.prev, prev: c.value }))
                })
            }
          : undefined
      })
    }
  })
}

/** Lets the undo action of a toast call back into the mutation after the component re-rendered. */
const updateRef: { current?: (input: UpdateInput) => void } = {}

export function useRegisterUndo() {
  const m = useUpdateWorkItem()
  updateRef.current = m.mutate
}

// ---- create -----------------------------------------------------------------------

export interface CreateInput {
  type: string
  fields: Record<string, unknown>
  parentId?: number
  /** Rich text fields written as markdown. */
  markdownFields?: string[]
  /** Open the new item in the drawer when done. */
  open?: boolean
}

export function buildCreateOps(c: Connection, input: CreateInput): PatchOp[] {
  const ops: PatchOp[] = Object.entries(input.fields)
    .filter(([, v]) => !isEmpty(v))
    .map(([field, value]) => ({ op: 'add', path: `/fields/${field}`, value }))
  for (const f of input.markdownFields ?? []) {
    if (!isEmpty(input.fields[f])) ops.push({ op: 'add', path: `/multilineFieldsFormat/${f}`, value: 'Markdown' })
  }
  if (input.parentId !== undefined) {
    ops.push({
      op: 'add',
      path: '/relations/-',
      value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: api.workItemApiUrl(c, input.parentId) }
    })
  }
  return ops
}

const isListQuery = (key: readonly unknown[]) => ['sprint', 'backlog', 'children'].includes(key[3] as string)

export function useCreateWorkItem() {
  const qc = useQueryClient()
  const connection = useUi((s) => s.connection)
  const openItem = useUi((s) => s.openItem)

  return useMutation({
    mutationFn: (input: CreateInput) => api.createWorkItem(connection!, input.type, buildCreateOps(connection!, input)),
    onError: (err, input) => toast({ kind: 'error', message: `Couldn’t create ${input.type}`, detail: describe(err) }),
    onSuccess: (res, input) => {
      if (res.dryRun) {
        toast({ kind: 'info', message: `Validated new ${input.type}`, detail: 'Azure DevOps accepted it — nothing was created (validate mode).' })
        return
      }
      void qc.invalidateQueries({ predicate: (q) => isListQuery(q.queryKey) })
      if (input.parentId !== undefined) void qc.invalidateQueries({ predicate: (q) => isDetailOf(q.queryKey, input.parentId!) })
      if (input.open) openItem(res.data.id)
      toast({
        kind: 'success',
        message: `Created ${input.type} #${res.data.id}`,
        detail: String(res.data.fields['System.Title'] ?? ''),
        action: input.open ? undefined : { label: 'Open', run: () => openItem(res.data.id) }
      })
    }
  })
}

// ---- comments ----------------------------------------------------------------------

export function useAddComment(id: number) {
  const qc = useQueryClient()
  const connection = useUi((s) => s.connection)
  const isComments = (key: readonly unknown[]) => key[3] === 'comments' && key[4] === id
  return useMutation({
    mutationFn: (markdown: string) => api.addComment(connection!, id, markdown),
    onError: (err) => toast({ kind: 'error', message: 'Couldn’t post comment', detail: describe(err) }),
    onSuccess: (res) => {
      if (res.dryRun) {
        toast({ kind: 'info', message: 'Comment not posted', detail: 'Validate mode: comments are never sent.' })
        return
      }
      for (const q of qc.getQueryCache().findAll({ predicate: (q) => isComments(q.queryKey) })) {
        qc.setQueryData(q.queryKey, [res.data, ...((q.state.data as Comment[] | undefined) ?? [])])
      }
    }
  })
}

// ---- backlog order ------------------------------------------------------------------

export interface ReorderInput {
  move: Move
  /** Where the item was, so the toast can offer Undo. */
  undo?: Move
  label: string
}

const isBacklogQuery = (key: readonly unknown[]) => key[3] === 'backlog'

export function useReorderBacklog() {
  const qc = useQueryClient()
  const connection = useUi((s) => s.connection)

  const mutation = useMutation({
    mutationFn: (input: ReorderInput) => api.reorderBacklog(connection!, input.move),
    onMutate: (input) => {
      const snap = snapshot(qc)
      for (const q of qc.getQueryCache().findAll({ predicate: (q) => isBacklogQuery(q.queryKey) })) {
        const d = q.state.data as { ids: number[] } | undefined
        if (d?.ids.includes(input.move.ids[0])) qc.setQueryData(q.queryKey, { ...d, ids: applyMove(d.ids, input.move) })
      }
      // Expanded children of a parent (`children` queries are keyed by the parent id).
      if (input.move.parentId !== undefined) {
        for (const q of qc.getQueryCache().findAll({ predicate: (q) => q.queryKey[3] === 'children' && q.queryKey[4] === input.move.parentId })) {
          const list = q.state.data as WorkItem[] | undefined
          if (!list?.some((w) => w.id === input.move.ids[0])) continue
          const byId = new Map(list.map((w) => [w.id, w]))
          qc.setQueryData(q.queryKey, applyMove(list.map((w) => w.id), input.move).map((id) => byId.get(id)!))
        }
      }
      return { snap }
    },
    onError: (err, input, ctx) => {
      if (ctx) restore(qc, ctx.snap)
      toast({ kind: 'error', message: `Couldn’t move #${input.move.ids[0]}`, detail: describe(err) })
    },
    onSuccess: (res, input, ctx) => {
      if (res.dryRun) {
        if (ctx) restore(qc, ctx.snap)
        toast({
          kind: 'info',
          message: `#${input.move.ids[0]} not moved (validate mode)`,
          detail: 'Reordering is never sent in validate mode — Azure DevOps has no validate-only option for it.'
        })
        return
      }
      // Keep the order field in sync so other views sorted by it (sprint lanes) follow.
      for (const { id, order } of res.data) mapCachedItem(qc, id, (w) => ({ ...w, order }))
      const undo = input.undo
      toast({
        kind: 'success',
        message: `#${input.move.ids[0]} · ${input.label}`,
        action: undo ? { label: 'Undo', run: () => reorderRef.current?.({ move: undo, label: 'Move undone' }) } : undefined
      })
    }
  })
  reorderRef.current = mutation.mutate
  return mutation
}

const reorderRef: { current?: (input: ReorderInput) => void } = {}

// ---- small helpers for callers ------------------------------------------------------------

/** Wire value for System.AssignedTo. */
export const identityValue = (who?: Identity | null) => (who ? (who.uniqueName ?? who.displayName) : '')

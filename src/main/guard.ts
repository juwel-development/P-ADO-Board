// Which requests the main process lets through to Azure DevOps. Pure module so it can be tested
// without Electron.

export type WriteMode = 'off' | 'validate' | 'live'

export type WriteKind = 'update' | 'create' | 'comment' | 'reorder'

export type Verdict =
  | { allow: true; kind: 'read' }
  | { allow: true; kind: WriteKind }
  | { allow: false; reason: string }

/** POSTs that only query data. */
const READ_POSTS = [/^\/[^/]+\/_apis\/wit\/workitemsbatch$/i, /^\/[^/]+(\/[^/]+)?\/_apis\/wit\/wiql$/i]

/** The only writes the app performs. Deleting, links-only endpoints, settings etc. are never allowed. */
const WRITES: { method: string; pattern: RegExp; kind: WriteKind }[] = [
  { method: 'PATCH', pattern: /^\/[^/]+\/_apis\/wit\/workitems\/\d+$/i, kind: 'update' },
  { method: 'POST', pattern: /^\/[^/]+\/_apis\/wit\/workitems\/\$[^/]+$/i, kind: 'create' },
  { method: 'POST', pattern: /^\/[^/]+\/_apis\/wit\/workitems\/\d+\/comments$/i, kind: 'comment' },
  // Backlog order (StackRank) of a team's backlog: /{project}/{team}/_apis/work/workitemsorder
  { method: 'PATCH', pattern: /^\/[^/]+\/[^/]+\/_apis\/work\/workitemsorder$/i, kind: 'reorder' }
]

export function checkRequest(method: string, path: string, mode: WriteMode): Verdict {
  if (path.includes('..') || path.includes('?') || path.includes('#')) return { allow: false, reason: 'Malformed path.' }
  if (method === 'GET') return { allow: true, kind: 'read' }
  if (method === 'POST' && READ_POSTS.some((r) => r.test(path))) return { allow: true, kind: 'read' }

  const write = WRITES.find((w) => w.method === method && w.pattern.test(path))
  if (!write) return { allow: false, reason: `${method} ${path} is not an allowed operation.` }
  if (mode === 'off') return { allow: false, reason: 'Editing is turned off (ADO_BOARD_WRITES=off).' }
  return { allow: true, kind: write.kind }
}

/** Unset means `live`; anything unrecognised (e.g. a typo) fails safe to `off`. */
export function parseWriteMode(value: string | undefined): WriteMode {
  const v = value?.trim().toLowerCase()
  if (!v || v === 'live') return 'live'
  return v === 'validate' ? 'validate' : 'off'
}

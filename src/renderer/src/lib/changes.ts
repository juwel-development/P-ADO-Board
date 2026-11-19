// Turns work item revisions (GET …/workItems/{id}/updates) into the human-readable changes shown in the
// inbox and in notifications. Pure (no DOM, no React) so it can be tested in isolation.

export interface Person {
  id?: string
  displayName: string
  uniqueName?: string
  imageUrl?: string
}

interface Base {
  by: Person
  at: string
}

export type Change =
  | (Base & { kind: 'comment'; text: string })
  /** Someone @mentioned you; `where` is `comment` or the field label (e.g. `Description`). */
  | (Base & { kind: 'mention'; where: string; text: string })
  /** Pull request events: a new PR in a followed repo, or you were asked to review one. */
  | (Base & { kind: 'pr'; event: 'opened' | 'reviewer'; target: string; required?: boolean })
  | (Base & { kind: 'text'; field: string; label: string; added: string[]; removed: string[] })
  | (Base & { kind: 'tags'; added: string[]; removed: string[] })
  | (Base & { kind: 'state'; from?: string; to?: string })
  | (Base & { kind: 'assigned'; from?: string; to?: string })
  | (Base & { kind: 'field'; field: string; label: string; from?: string; to?: string })
  | (Base & { kind: 'link'; action: 'added' | 'removed'; label: string; targetId?: number })

interface UpdateRelation {
  rel: string
  url: string
  attributes?: { name?: string }
}

export interface WorkItemUpdate {
  id: number
  rev: number
  revisedBy: Person
  /** When this revision was superseded (9999-01-01 for the latest one) — not when it was made. */
  revisedDate?: string
  fields?: Record<string, { oldValue?: unknown; newValue?: unknown }>
  relations?: { added?: UpdateRelation[]; removed?: UpdateRelation[] }
}

export interface DescribeOptions {
  /** Only revisions newer than this are described. */
  sinceRev: number
  /** Identity id of the signed-in user; their own changes are never reported. */
  meId?: string
  /** Display name of the signed-in user; used to render and (as a fallback) detect their mentions. */
  meName?: string
  /** Reference name → display name, for fields without a built-in label. */
  fieldNames?: Map<string, string>
  /** Extra fields to ignore (e.g. the team's backlog order field). */
  ignore?: string[]
}

/** Bookkeeping fields that change with every save or mirror another change. */
const IGNORED = new Set([
  'System.Id',
  'System.Rev',
  'System.RevisedDate',
  'System.ChangedDate',
  'System.ChangedBy',
  'System.AuthorizedDate',
  'System.AuthorizedAs',
  'System.PersonId',
  'System.Watermark',
  'System.CreatedDate',
  'System.CreatedBy',
  'System.CommentCount',
  'System.Reason',
  'System.AreaId',
  'System.IterationId',
  'System.NodeName',
  'System.TeamProject',
  'System.Parent',
  'System.BoardColumnDone',
  'System.ExternalLinkCount',
  'System.HyperLinkCount',
  'System.AttachedFileCount',
  'System.RelatedLinkCount',
  'System.RemoteLinkCount',
  'Microsoft.VSTS.Common.StateChangeDate',
  'Microsoft.VSTS.Common.ActivatedDate',
  'Microsoft.VSTS.Common.ActivatedBy',
  'Microsoft.VSTS.Common.ResolvedDate',
  'Microsoft.VSTS.Common.ResolvedBy',
  'Microsoft.VSTS.Common.ClosedDate',
  'Microsoft.VSTS.Common.ClosedBy',
  'Microsoft.VSTS.Common.StackRank',
  'Microsoft.VSTS.Common.BacklogPriority'
])
const IGNORED_PATTERNS = [/^System\.(Area|Iteration)Level\d+$/, /^WEF_/, /_Kanban\./]

const RICH = new Map([
  ['System.Description', 'Description'],
  ['Microsoft.VSTS.TCM.ReproSteps', 'Repro steps'],
  ['Microsoft.VSTS.Common.AcceptanceCriteria', 'Acceptance criteria'],
  ['Microsoft.VSTS.TCM.SystemInfo', 'System info']
])

const LABELS = new Map([
  ['System.Title', 'Title'],
  ['System.IterationPath', 'Iteration'],
  ['System.AreaPath', 'Area'],
  ['System.WorkItemType', 'Type'],
  ['System.BoardColumn', 'Board column'],
  ['System.BoardLane', 'Swimlane'],
  ['Microsoft.VSTS.Common.Priority', 'Priority'],
  ['Microsoft.VSTS.Common.Severity', 'Severity'],
  ['Microsoft.VSTS.Common.Activity', 'Activity'],
  ['Microsoft.VSTS.Common.ValueArea', 'Value area'],
  ['Microsoft.VSTS.Scheduling.Effort', 'Effort'],
  ['Microsoft.VSTS.Scheduling.StoryPoints', 'Story points'],
  ['Microsoft.VSTS.Scheduling.RemainingWork', 'Remaining work'],
  ['Microsoft.VSTS.Scheduling.CompletedWork', 'Completed work'],
  ['Microsoft.VSTS.Scheduling.OriginalEstimate', 'Original estimate'],
  ['Microsoft.VSTS.Scheduling.TargetDate', 'Target date'],
  ['Microsoft.VSTS.Scheduling.StartDate', 'Start date']
])

const LINKS: Record<string, string> = {
  'System.LinkTypes.Hierarchy-Forward': 'child',
  'System.LinkTypes.Hierarchy-Reverse': 'parent',
  'System.LinkTypes.Related': 'related item',
  'System.LinkTypes.Dependency-Forward': 'successor',
  'System.LinkTypes.Dependency-Reverse': 'predecessor',
  'System.LinkTypes.Duplicate-Forward': 'duplicate',
  'System.LinkTypes.Duplicate-Reverse': 'duplicate of',
  Hyperlink: 'hyperlink',
  AttachedFile: 'attachment'
}

const isIgnored = (field: string, extra: Set<string>) =>
  IGNORED.has(field) || extra.has(field) || IGNORED_PATTERNS.some((r) => r.test(field))

const isMe = (p: Person | undefined, meId?: string) => !!meId && !!p?.id && p.id.toLowerCase() === meId.toLowerCase()

/** Server time of a revision: its ChangedDate, else revisedDate when it's a real date. */
function revisionTime(u: WorkItemUpdate): string {
  const changed = u.fields?.['System.ChangedDate']?.newValue
  if (typeof changed === 'string') return changed
  if (u.revisedDate && !u.revisedDate.startsWith('9999')) return u.revisedDate
  return new Date().toISOString()
}

// ---- value formatting ----------------------------------------------------------

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Plain-text lines of an HTML or markdown value, with markup removed, for diffing and previews. */
export function textLines(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return []
  let s = value
  if (/<[a-z][^>]*>/i.test(s)) {
    s = s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|pre|blockquote|table|ul|ol)>/gi, '\n')
      .replace(/<(td|th)[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  }
  return decodeEntities(s)
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
        .replace(/(\*\*|__|~~|`)/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
}

/** Single-line plain-text preview, e.g. for comment snippets. */
export function plainText(value: unknown, max = 200): string {
  return truncate(textLines(value).join(' '), max)
}

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

function personName(v: unknown): string | undefined {
  if (!v) return undefined
  if (typeof v === 'object' && 'displayName' in v) return String((v as Person).displayName)
  // Older payloads use "Display Name <domain\\user>".
  if (typeof v === 'string') return v.replace(/\s*<[^>]*>\s*$/, '') || undefined
  return undefined
}

function formatValue(field: string, v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v === 'object') return personName(v) ?? truncate(JSON.stringify(v), 80)
  if (field === 'System.IterationPath') return String(v).split('\\').pop()
  if (field === 'System.AreaPath') return String(v).split('\\').slice(1).join(' / ') || String(v)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  return truncate(textLines(String(v)).join(' ') || String(v), 80)
}

const splitTags = (v: unknown) =>
  typeof v === 'string'
    ? v
        .split(';')
        .map((t) => t.trim())
        .filter(Boolean)
    : []

/** Lines that only exist on one side (multiset difference), capped for display. */
function lineDiff(before: string[], after: string[], cap = 4) {
  const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())
  const only = (xs: string[], other: Map<string, number>) =>
    xs.filter((x) => {
      const n = other.get(x) ?? 0
      if (n > 0) other.set(x, n - 1)
      return n === 0
    })
  return {
    added: only(after, count(before))
      .slice(0, cap)
      .map((l) => truncate(l, 160)),
    removed: only(before, count(after))
      .slice(0, cap)
      .map((l) => truncate(l, 160))
  }
}

function linkChange(r: UpdateRelation, action: 'added' | 'removed', base: Base): Change {
  const targetId = /\/workItems\/(\d+)$/i.exec(r.url)?.[1]
  const label = r.rel === 'ArtifactLink' ? (r.attributes?.name ?? 'artifact') : (LINKS[r.rel] ?? r.attributes?.name ?? 'link')
  const name = r.rel === 'AttachedFile' || r.rel === 'Hyperlink' ? r.attributes?.name : undefined
  return { ...base, kind: 'link', action, label: name ? `${label} ${name}` : label, targetId: targetId ? Number(targetId) : undefined }
}

// ---- mentions --------------------------------------------------------------------------

const HTML_MENTION = /<a\b[^>]*data-vss-mention="version:[\d.]+,([^"]+)"[^>]*>([^<]*)<\/a>/gi
const MD_MENTION = /@<([^>\s]+)>/g

/** How often `value` @mentions the user: HTML anchors and markdown `@<id>`, by id; else by name. */
export function countMentions(value: unknown, meId?: string, meName?: string): number {
  if (typeof value !== 'string' || !value) return 0
  const id = meId?.toLowerCase()
  let byId = 0
  let byName = 0
  for (const m of value.matchAll(HTML_MENTION)) {
    if (id && m[1].toLowerCase() === id) byId++
    else if (meName && m[2].trim().toLowerCase() === `@${meName}`.toLowerCase()) byName++
  }
  for (const m of value.matchAll(MD_MENTION)) if (id && m[1].toLowerCase() === id) byId++
  return byId || byName
}

/** Replaces markdown `@<id>` mentions with readable names (yours by name, others as `@someone`). */
export function readableMentions(value: unknown, meId?: string, meName?: string): string {
  if (typeof value !== 'string') return ''
  return value.replace(MD_MENTION, (_m, id: string) => (meId && id.toLowerCase() === meId.toLowerCase() ? `@${meName ?? 'you'}` : '@someone'))
}

/** The line of `value` that mentions the user (or the start of the text), as plain text. */
export function mentionSnippet(value: unknown, meId?: string, meName?: string): string {
  const lines = textLines(readableMentions(value, meId, meName))
  const hit = meName ? lines.find((l) => l.toLowerCase().includes(`@${meName}`.toLowerCase())) : undefined
  return truncate(hit ?? lines.join(' '), 220)
}

// ---- describing revisions -----------------------------------------------------------

/**
 * Describes the revisions after `sinceRev`, newest first. Consecutive edits of the same field by the same
 * person collapse into one change (first old value → last new value); edits that cancel out disappear.
 */
export function describeUpdates(updates: WorkItemUpdate[], opts: DescribeOptions): Change[] {
  const ignore = new Set(opts.ignore ?? [])
  const out: Change[] = []
  // Collapsible field edits: key → index in `out` plus the raw values to recompute from.
  const open = new Map<string, { index: number; first: unknown }>()

  const sorted = [...updates].filter((u) => u.rev > opts.sinceRev).sort((a, b) => a.rev - b.rev)
  for (const u of sorted) {
    if (isMe(u.revisedBy, opts.meId)) continue
    const base: Base = { by: u.revisedBy, at: revisionTime(u) }
    const fields = u.fields ?? {}
    const stateChanged = 'System.State' in fields

    // Comments added through the comments API may only bump the count; the text is filled in later.
    const count = fields['System.CommentCount']
    if (!fields['System.History'] && count && Number(count.newValue ?? 0) > Number(count.oldValue ?? 0)) {
      for (let i = Number(count.oldValue ?? 0); i < Number(count.newValue); i++) out.push({ ...base, kind: 'comment', text: '' })
    }

    for (const [field, { oldValue, newValue }] of Object.entries(fields)) {
      if (field === 'System.History') {
        if (countMentions(newValue, opts.meId, opts.meName) > 0) {
          out.push({ ...base, kind: 'mention', where: 'comment', text: mentionSnippet(newValue, opts.meId, opts.meName) })
        } else {
          const text = plainText(readableMentions(newValue, opts.meId, opts.meName), 280)
          if (text) out.push({ ...base, kind: 'comment', text })
        }
        continue
      }
      if (isIgnored(field, ignore)) continue
      // A new mention in a text field (e.g. the description) is reported on its own, besides the edit.
      if (typeof newValue === 'string' && countMentions(newValue, opts.meId, opts.meName) > countMentions(oldValue, opts.meId, opts.meName)) {
        const where = RICH.get(field) ?? LABELS.get(field) ?? opts.fieldNames?.get(field) ?? field.split('.').pop()!
        out.push({ ...base, kind: 'mention', where, text: mentionSnippet(newValue, opts.meId, opts.meName) })
      }
      // The board column follows the state; only report it when it moved on its own.
      if (field === 'System.BoardColumn' && stateChanged) continue

      const key = `${field}|${u.revisedBy.id ?? u.revisedBy.displayName}`
      const prev = open.get(key)
      if (prev) {
        out[prev.index] = fieldChange(field, prev.first, newValue, base, opts)
      } else {
        open.set(key, { index: out.length, first: oldValue })
        out.push(fieldChange(field, oldValue, newValue, base, opts))
      }
    }

    for (const r of u.relations?.added ?? []) out.push(linkChange(r, 'added', base))
    for (const r of u.relations?.removed ?? []) out.push(linkChange(r, 'removed', base))
  }

  // Newest first; a collapsed change sorts by its latest edit.
  return out
    .filter((c) => !isNoop(c))
    .reverse()
    .sort((a, b) => b.at.localeCompare(a.at))
}

function fieldChange(field: string, from: unknown, to: unknown, base: Base, opts: DescribeOptions): Change {
  if (field === 'System.Tags') {
    const before = splitTags(from)
    const after = splitTags(to)
    const lower = (xs: string[]) => new Set(xs.map((t) => t.toLowerCase()))
    const b = lower(before)
    const a = lower(after)
    return { ...base, kind: 'tags', added: after.filter((t) => !b.has(t.toLowerCase())), removed: before.filter((t) => !a.has(t.toLowerCase())) }
  }
  if (field === 'System.State') return { ...base, kind: 'state', from: formatValue(field, from), to: formatValue(field, to) }
  if (field === 'System.AssignedTo') return { ...base, kind: 'assigned', from: personName(from), to: personName(to) }
  const richLabel = RICH.get(field)
  const isLongText = richLabel || (typeof to === 'string' && (to.length > 200 || /<[a-z][^>]*>|\n/i.test(to)))
  const label = richLabel ?? LABELS.get(field) ?? opts.fieldNames?.get(field) ?? field.split('.').pop()!
  if (isLongText) {
    const lines = (v: unknown) => textLines(readableMentions(v, opts.meId, opts.meName))
    return { ...base, kind: 'text', field, label, ...lineDiff(lines(from), lines(to)) }
  }
  return { ...base, kind: 'field', field, label, from: formatValue(field, from), to: formatValue(field, to) }
}

function isNoop(c: Change): boolean {
  switch (c.kind) {
    case 'tags':
      return c.added.length === 0 && c.removed.length === 0
    case 'state':
    case 'assigned':
    case 'field':
      return c.from === c.to
    case 'text':
      // Formatting-only edits (e.g. HTML → markdown with identical text) aren't worth a notification.
      return c.added.length === 0 && c.removed.length === 0
    default:
      return false
  }
}

// ---- summaries ------------------------------------------------------------------------

/** Short phrase for one change, e.g. `State → Closed` or `commented “Looks good”`. */
export function changePhrase(c: Change): string {
  switch (c.kind) {
    case 'comment':
      return `commented “${truncate(c.text, 90)}”`
    case 'pr':
      return c.event === 'opened' ? `opened a pull request into ${c.target}` : `wants your review${c.required ? ' (required)' : ''}`
    case 'mention':
      return `mentioned you${c.where === 'comment' ? '' : ` in ${c.where}`}: “${truncate(c.text, 90)}”`
    case 'text':
      return `edited ${c.label}`
    case 'tags':
      return ['tags', ...c.added.map((t) => `+${t}`), ...c.removed.map((t) => `−${t}`)].join(' ')
    case 'state':
      return `State → ${c.to ?? '—'}`
    case 'assigned':
      return c.to ? `assigned to ${c.to}` : 'unassigned'
    case 'field':
      return `${c.label} → ${c.to ?? '—'}`
    case 'link':
      return `${c.action} ${c.label}${c.targetId ? ` #${c.targetId}` : ''}`
  }
}

/** Notification body: `Anna Schmidt: State → Closed, commented “…”` (one clause per author). */
export function summarize(changes: Change[], max = 3): string {
  const byAuthor = new Map<string, Change[]>()
  for (const c of [...changes].reverse()) {
    const name = c.by.displayName
    byAuthor.set(name, [...(byAuthor.get(name) ?? []), c])
  }
  return [...byAuthor]
    .map(([name, cs]) => {
      const phrases = [...new Set(cs.map(changePhrase))]
      const shown = phrases.slice(0, max).join(', ')
      return `${name}: ${shown}${phrases.length > max ? ` +${phrases.length - max} more` : ''}`
    })
    .join(' · ')
}

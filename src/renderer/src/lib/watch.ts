import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import type { Connection } from '@shared/ipc'
import * as api from './api'
import { countMentions, describeUpdates, mentionSnippet, plainText, readableMentions, summarize, type Change } from './changes'
import type { Meta } from './model'
import { key, useMe, useMeta } from './queries'
import { diffPulls, branchName, type FollowedRepo, type PullEvent } from './pulls'
import { useUi } from './store'
import { toast } from './toasts'

// Local subscriptions: which items to watch, the last revision seen of each, and an inbox of what others
// changed since. Stored by the main process per org + project; checked every few minutes while the app runs.

export const CHECK_INTERVAL_MS = 5 * 60_000
const MAX_INBOX = 300

export interface Subscription {
  id: number
  /** `auto`: you created it and it's still open · `manual`: subscribed from the item panel. */
  source: 'auto' | 'manual'
  rev: number
  title: string
  type: string
  state: string
  since: string
}

export interface InboxEntry {
  /** Stable while the entry is unread; new changes to the same item merge into it. */
  key: string
  id: number
  title: string
  type: string
  state: string
  at: string
  changes: Change[]
  read: boolean
  /** Set for pull request entries (`id` is then the PR id, not a work item id). */
  pr?: { repo: string; project: string; url: string; source: string; target: string; draft: boolean }
}

interface Persisted {
  v: 1
  subs: Record<number, Subscription>
  /** Auto-subscriptions the user turned off, so the next check doesn't add them again. */
  muted: number[]
  inbox: InboxEntry[]
  lastCheck?: string
  /** Last revision seen of each item in your recent mentions; absent until the first check seeded it. */
  mentionRevs?: Record<number, number>
  /** Followed repositories by id, with what the last check saw (see lib/pulls). */
  repos: Record<string, FollowedRepo>
  prSeen: Record<string, number[]>
  reviewSeen?: number[]
}

const PERSISTED: (keyof Persisted)[] = ['subs', 'muted', 'inbox', 'lastCheck', 'mentionRevs', 'repos', 'prSeen', 'reviewSeen']

interface WatchState extends Persisted {
  scope: string | null
  checking: boolean
  error?: string
  /** Pull request checks failed (e.g. the PAT lacks Code (Read)); work items still work. */
  repoError?: string

  subscribe(item: Omit<Subscription, 'source' | 'since'>): void
  unsubscribe(id: number): void
  /** Marks the work item's inbox entries read (not pull requests with the same number). */
  markRead(id: number): void
  markEntryRead(key: string): void
  followRepo(repo: { id: string; name: string; project: string }): void
  unfollowRepo(id: string): void
  setRepoBranches(id: string, branches: string[]): void
  markAllRead(): void
  dismiss(key: string): void
  clearRead(): void
}

const empty = (): Persisted => ({ v: 1, subs: {}, muted: [], inbox: [], repos: {}, prSeen: {} })

export const useWatch = create<WatchState>()((set) => ({
  ...empty(),
  scope: null,
  checking: false,

  subscribe: (item) =>
    set((s) => ({
      subs: { ...s.subs, [item.id]: { ...item, source: 'manual', since: new Date().toISOString() } },
      muted: s.muted.filter((x) => x !== item.id)
    })),
  unsubscribe: (id) =>
    set((s) => {
      const { [id]: gone, ...subs } = s.subs
      return { subs, muted: gone?.source === 'auto' ? [...new Set([...s.muted, id])] : s.muted }
    }),
  markRead: (id) => {
    const match = (e: InboxEntry) => e.id === id && !e.pr && !e.read
    set((s) => (s.inbox.some(match) ? { inbox: s.inbox.map((e) => (match(e) ? { ...e, read: true } : e)) } : s))
  },
  markEntryRead: (key) => set((s) => ({ inbox: s.inbox.map((e) => (e.key === key && !e.read ? { ...e, read: true } : e)) })),
  followRepo: (repo) =>
    set((s) => ({ repos: { ...s.repos, [repo.id]: { ...repo, since: new Date().toISOString(), branches: [] } } })),
  unfollowRepo: (id) =>
    set((s) => {
      const { [id]: _repo, ...repos } = s.repos
      const { [id]: _seen, ...prSeen } = s.prSeen
      return { repos, prSeen }
    }),
  setRepoBranches: (id, branches) =>
    set((s) => (s.repos[id] ? { repos: { ...s.repos, [id]: { ...s.repos[id], branches } } } : s)),
  markAllRead: () => set((s) => ({ inbox: s.inbox.map((e) => (e.read ? e : { ...e, read: true })) })),
  dismiss: (key) => set((s) => ({ inbox: s.inbox.filter((e) => e.key !== key) })),
  clearRead: () => set((s) => ({ inbox: s.inbox.filter((e) => !e.read) }))
}))

export const useUnreadCount = () => useWatch((s) => s.inbox.filter((e) => !e.read).length)

const scopeOf = (c: Connection) => `${c.orgUrl.replace(/\/+$/, '').toLowerCase()}|${c.project.toLowerCase()}`

const persisted = (s: WatchState) => ({ v: 1, ...Object.fromEntries(PERSISTED.map((k) => [k, s[k]])) }) as Persisted

async function load(c: Connection) {
  const scope = scopeOf(c)
  if (useWatch.getState().scope === scope) return
  const data = (await window.ado.watch.load(scope).catch(() => null)) as Persisted | null
  useWatch.setState({ ...empty(), mentionRevs: undefined, reviewSeen: undefined, ...(data?.v === 1 ? data : {}), scope, error: undefined, repoError: undefined })
}

// Persist every change (debounced) and keep the dock badge in sync with the unread count.
let saveTimer: ReturnType<typeof setTimeout> | undefined
useWatch.subscribe((s, prev) => {
  if (!s.scope || s.scope !== prev.scope) return
  if (PERSISTED.some((k) => s[k] !== prev[k])) {
    clearTimeout(saveTimer)
    const scope = s.scope
    saveTimer = setTimeout(() => void window.ado.watch.save(scope, persisted(useWatch.getState())).catch(() => {}), 400)
  }
})
let lastBadge = -1
useWatch.subscribe((s) => {
  const unread = s.inbox.filter((e) => !e.read).length
  if (unread !== lastBadge) void window.ado.setBadge((lastBadge = unread)).catch(() => {})
})

// ---- checking ---------------------------------------------------------------------------

interface Context {
  c: Connection
  meta: Meta
  meId: string
  meName: string
  qc: QueryClient
}

const doneStates = (meta: Meta) => [
  ...new Set([...meta.types.values()].flatMap((t) => t.states.filter((s) => s.category === 'Completed' || s.category === 'Removed').map((s) => s.name)))
]

async function inBatches<T, R>(xs: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < xs.length; i += size) out.push(...(await Promise.all(xs.slice(i, i + size).map(fn))))
  return out
}

/**
 * Comments posted through the comments API can arrive without text in the revision; fill it in from the
 * comments themselves (which is also where a mention in them shows up).
 */
async function fillCommentText(ctx: Context, id: number, changes: Change[]): Promise<Change[]> {
  if (!changes.some((c) => c.kind === 'comment' && !c.text)) return changes
  const comments = await api.getComments(ctx.c, id).catch(() => [])
  const others = comments.filter((c) => c.createdBy.id?.toLowerCase() !== ctx.meId.toLowerCase())
  // Both lists are newest first.
  let i = 0
  return changes.map((ch) => {
    if (ch.kind !== 'comment' || ch.text) return ch
    const src = others[i++]
    if (!src) return ch
    const raw = src.renderedText || src.text
    if (countMentions(src.text, ctx.meId, ctx.meName) || countMentions(src.renderedText, ctx.meId, ctx.meName)) {
      return { ...ch, kind: 'mention', where: 'comment', text: mentionSnippet(src.text || raw, ctx.meId, ctx.meName) }
    }
    return { ...ch, text: plainText(readableMentions(raw, ctx.meId, ctx.meName), 280) }
  })
}

async function check(ctx: Context): Promise<InboxEntry[]> {
  const { c, meta, meId, meName } = ctx
  const before = useWatch.getState()

  // 1. Which items should be watched: manual ones plus your open items (unless muted).
  let autoIds: number[] | null = null
  try {
    autoIds = await api.getOpenItemsCreatedByMe(c, doneStates(meta))
  } catch {
    autoIds = null // keep the current auto-subscriptions rather than dropping them on a failed query
  }
  const muted = new Set(before.muted)
  const wanted = new Set([...Object.keys(before.subs).map(Number), ...(autoIds ?? []).filter((id) => !muted.has(id))])
  // Items you were @mentioned on recently, followed or not.
  const mentionIds = await api.getRecentMentionIds(c).catch(() => null)

  // 2. Current revisions; only items with a newer revision need a closer look.
  const revisions = await api.getRevisions(c, [...new Set([...wanted, ...(mentionIds ?? [])])])
  const current = new Map(revisions.map((r) => [r.id, r]))
  const seen = before.mentionRevs // undefined on the very first check: existing mentions are only recorded
  const targets = [
    ...revisions
      .filter((r) => before.subs[r.id] && r.rev > before.subs[r.id].rev)
      .map((r) => ({ r, sinceRev: before.subs[r.id].rev, mentionsOnly: false, after: undefined as string | undefined })),
    // Not followed: only look for new mentions. Newly listed items have no baseline, so their recent
    // revisions are read and anything older than the last check is skipped.
    ...(seen && mentionIds
      ? revisions
          .filter((r) => mentionIds.includes(r.id) && !before.subs[r.id] && (seen[r.id] === undefined || r.rev > seen[r.id]))
          .map((r) => ({ r, sinceRev: seen[r.id] ?? Math.max(0, r.rev - 20), mentionsOnly: true, after: seen[r.id] === undefined ? before.lastCheck : undefined }))
      : [])
  ]

  const ignore = meta.fieldMap.order ? [meta.fieldMap.order] : []
  const fieldNames = new Map([...meta.types.values()].flatMap((t) => (t.fields ?? []).map((f) => [f.referenceName, f.name] as const)))
  const found = await inBatches(targets, 4, async ({ r, sinceRev, mentionsOnly, after }) => {
    const updates = await api.getUpdatesSince(c, r.id, sinceRev)
    let changes = await fillCommentText(ctx, r.id, describeUpdates(updates, { sinceRev, meId, meName, fieldNames, ignore }))
    if (mentionsOnly) changes = changes.filter((ch) => ch.kind === 'mention' && (!after || ch.at > after))
    return { r, changes }
  })

  // 3. Apply: new baselines, new/merged inbox entries, auto-subscriptions in and out.
  const now = new Date().toISOString()
  const fresh: InboxEntry[] = []
  const auto = autoIds ? new Set(autoIds) : null
  useWatch.setState((s) => {
    // Works on the live state: (un)subscribing while the check ran must not be undone.
    const liveMuted = new Set(s.muted)
    const subs: Record<number, Subscription> = {}
    for (const id of new Set([...wanted, ...Object.keys(s.subs).map(Number)])) {
      const prev = s.subs[id]
      const r = current.get(id)
      if (!r) {
        if (prev && !wanted.has(id)) subs[id] = prev // subscribed during this check
        continue // otherwise deleted, moved to another project, or no longer visible
      }
      const isAuto = auto ? auto.has(id) : prev?.source === 'auto'
      if (!prev && (!isAuto || liveMuted.has(id) || before.subs[id])) continue // new and not auto, or unsubscribed meanwhile
      // An auto-subscription ends when the item is done; a manual one stays until you unsubscribe.
      if (prev?.source === 'auto' && !isAuto) continue
      subs[id] = { id, source: prev?.source ?? 'auto', since: prev?.since ?? now, rev: r.rev, title: r.title, type: r.type, state: r.state }
    }

    let inbox = s.inbox
    for (const { r, changes } of found) {
      if (!changes.length) continue
      const existing = inbox.find((e) => e.id === r.id && !e.pr && !e.read)
      const entry: InboxEntry = {
        key: existing?.key ?? `${r.id}:${r.rev}`,
        id: r.id,
        title: r.title,
        type: r.type,
        state: r.state,
        at: changes[0].at,
        changes: [...changes, ...(existing?.changes ?? [])].slice(0, 60),
        read: false
      }
      fresh.push({ ...entry, changes })
      inbox = [entry, ...inbox.filter((e) => e !== existing)]
    }
    const mentionRevs = mentionIds
      ? Object.fromEntries(mentionIds.flatMap((id) => (current.has(id) ? [[id, current.get(id)!.rev]] : [])))
      : s.mentionRevs
    return { subs, inbox: inbox.slice(0, MAX_INBOX), lastCheck: now, mentionRevs, error: undefined }
  })

  // Open item panels and lists showing these items should reflect the new state.
  for (const { r } of found) {
    void ctx.qc.invalidateQueries({ predicate: (q) => (q.queryKey[3] === 'item' || q.queryKey[3] === 'comments') && q.queryKey[4] === r.id })
  }
  return [...fresh, ...(await checkPulls(ctx))]
}

/** New pull requests in followed repositories, and pull requests you were added to as a reviewer. */
async function checkPulls(ctx: Context): Promise<InboxEntry[]> {
  const { c, meId } = ctx
  const before = useWatch.getState()
  const repos = Object.values(before.repos)
  // One line per distinct problem (a PAT without Code (Read) fails every request the same way).
  const errors = new Set<string>()
  const fail = (e: unknown) => errors.add(e instanceof api.AdoError && (e.status === 401 || e.status === 403) ? 'Not authorized. The PAT needs the scope Code (Read).' : (e as Error).message)

  const active = new Map<string, api.PullRequest[]>()
  await inBatches(repos, 4, async (repo) => {
    try {
      const prs = await api.getActivePullRequests(repo.project, repo.id)
      active.set(repo.id, prs)
      ctx.qc.setQueryData(key('pulls', repo.id), prs) // sidebar counts and the repository view
    } catch (e) {
      fail(e)
    }
  })
  // Review requests: the board's project plus the projects of followed repositories.
  let toReview: api.PullRequest[] | null
  try {
    const projects = [...new Set([c.project, ...repos.map((r) => r.project)])]
    const all = (await Promise.all(projects.map((p) => api.getPullRequestsToReview(p, meId)))).flat()
    toReview = [...new Map(all.map((pr) => [pr.pullRequestId, pr])).values()]
  } catch (e) {
    toReview = null
    fail(e)
  }

  const { events, state } = diffPulls(repos, active, toReview, { prSeen: before.prSeen, reviewSeen: before.reviewSeen }, meId)
  const byPr = new Map<string, PullEvent[]>()
  for (const ev of events) {
    const key = `pr:${ev.pr.repository.id}:${ev.pr.pullRequestId}`
    byPr.set(key, [...(byPr.get(key) ?? []), ev])
  }

  const now = new Date().toISOString()
  const fresh: InboxEntry[] = []
  useWatch.setState((s) => {
    let inbox = s.inbox
    for (const [key, evs] of byPr) {
      const pr = evs[0].pr
      const project = pr.repository.project.name
      const target = branchName(pr.targetRefName)
      const changes: Change[] = evs.map((ev) => ({
        kind: 'pr',
        event: ev.event,
        required: ev.required,
        target,
        by: pr.createdBy,
        // When you were added as a reviewer isn't known; it happened since the last check.
        at: ev.event === 'opened' ? pr.creationDate : now
      }))
      const existing = inbox.find((e) => e.key === key)
      const entry: InboxEntry = {
        key,
        id: pr.pullRequestId,
        title: pr.title,
        type: 'Pull request',
        state: pr.isDraft ? 'Draft' : 'Active',
        at: changes.map((x) => x.at).sort().at(-1)!,
        changes: [...changes, ...(existing?.changes ?? [])].slice(0, 60),
        read: false,
        pr: {
          repo: pr.repository.name,
          project,
          url: api.pullRequestWebUrl(c, project, pr.repository.name, pr.pullRequestId),
          source: branchName(pr.sourceRefName),
          target,
          draft: !!pr.isDraft
        }
      }
      fresh.push({ ...entry, changes })
      inbox = [entry, ...inbox.filter((e) => e !== existing)]
    }
    // A repository unfollowed while the check ran stays unfollowed.
    const prSeen = Object.fromEntries(Object.entries(state.prSeen).filter(([id]) => s.repos[id]))
    return { inbox: inbox.slice(0, MAX_INBOX), prSeen, reviewSeen: state.reviewSeen, repoError: errors.size ? [...errors].join(' · ') : undefined }
  })
  return fresh
}

export const entryTitle = (e: InboxEntry) => (e.pr ? `${e.pr.repo} !${e.id} ${e.title}` : `#${e.id} ${e.title}`)

/** Changes addressed to you personally: mentions and review requests. */
export const isForYou = (c: Change) => c.kind === 'mention' || (c.kind === 'pr' && c.event === 'reviewer')

function announce(fresh: InboxEntry[]) {
  if (!fresh.length) return
  const ui = useUi.getState()
  // In-app toasts while the window is in front; OS notifications only once the user turned them on.
  const focused = document.hasFocus()
  if (!focused && ui.notifications !== 'on') return
  const show = (title: string, body: string, tag: string, action: { label: string; run(): void }) =>
    focused ? toast({ kind: 'info', message: title, detail: body, action }, 9000) : void window.ado.notify({ title, body, tag })
  const open = (e: InboxEntry) => ({ label: 'Open', run: () => openEntry(e.key) })

  // Mentions and review requests are addressed to you: one notification each, never folded into a summary.
  for (const e of fresh) {
    for (const ch of e.changes) {
      if (ch.kind === 'mention') {
        const where = ch.where === 'comment' ? '' : ` in the ${ch.where.toLowerCase()}`
        show(`${ch.by.displayName} mentioned you${where}`, `${entryTitle(e)}\n“${ch.text}”`, `entry:${e.key}`, open(e))
      } else if (ch.kind === 'pr' && ch.event === 'reviewer') {
        show(`${ch.by.displayName} wants your review${ch.required ? ' (required)' : ''}`, `${entryTitle(e)}\n${e.pr?.source} → ${ch.target}`, `entry:${e.key}`, open(e))
      }
    }
  }

  const rest = fresh
    .map((e) => ({ ...e, changes: e.changes.filter((c) => !isForYou(c)) }))
    .filter((e) => e.changes.length > 0)
  if (rest.length > 3) {
    const body = rest.map(entryTitle).join(' · ')
    show(`${rest.length} updates on things you follow`, body, 'inbox', { label: 'Inbox', run: () => ui.setView('inbox') })
    return
  }
  for (const e of rest) show(entryTitle(e), summarize(e.changes), `entry:${e.key}`, open(e))
}

/** Opens what an inbox entry is about (work item panel, or the pull request in the browser) and marks it read. */
export function openEntry(key: string) {
  const e = useWatch.getState().inbox.find((x) => x.key === key)
  if (!e) return
  useWatch.getState().markEntryRead(key)
  if (e.pr) void window.ado.openExternal(e.pr.url)
  else useUi.getState().openItem(e.id)
}

let running: Promise<void> | null = null
let context: Context | null = null

/** Runs a check now (no-op while one is running or before the app is connected). */
export function checkNow(): Promise<void> {
  if (!context) return Promise.resolve()
  if (running) return running
  const ctx = context
  useWatch.setState({ checking: true })
  running = check(ctx)
    .then(announce)
    .catch((e: Error) => useWatch.setState({ error: e.message }))
    .finally(() => {
      running = null
      useWatch.setState({ checking: false })
    })
  return running
}

/** Loads subscriptions for the current connection and checks them on start and every 5 minutes. */
export function useWatcher() {
  const c = useUi((s) => s.connection)
  const meta = useMeta().data
  const me = useMe().data
  const qc = useQueryClient()

  useEffect(() => {
    if (!c || !meta || !me) return
    let cancelled = false
    let startup: ReturnType<typeof setTimeout> | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    void load(c).then(() => {
      if (cancelled) return
      context = { c, meta, meId: me.id, meName: me.providerDisplayName, qc }
      // Catch up shortly after start (after the board has loaded), then on a fixed interval.
      startup = setTimeout(() => void checkNow(), 4000)
      timer = setInterval(() => void checkNow(), CHECK_INTERVAL_MS)
    })
    return () => {
      cancelled = true
      clearTimeout(startup)
      clearInterval(timer)
      context = null
    }
  }, [c, meta, me, qc])

  useEffect(
    () =>
      window.ado.onNotificationClick((tag) => {
        const key = /^entry:(.+)$/.exec(tag)?.[1]
        if (key) openEntry(key)
        else useUi.getState().setView('inbox')
      }),
    []
  )
}

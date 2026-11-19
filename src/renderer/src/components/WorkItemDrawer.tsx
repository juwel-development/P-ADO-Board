import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Bell, BellOff, Check, Copy, GitBranch, Link2, MessageCircle, Pencil, Plus, X } from 'lucide-react'
import { workItemWebUrl } from '@/lib/api'
import type { Meta } from '@/lib/model'
import { isTaskLevel, stateInfo, typeColor, typeHasField } from '@/lib/model'
import { identityValue, useAddComment, useUpdateWorkItem, type FieldChange } from '@/lib/mutations'
import { useAllowedValues, useComments, useIterations, useMeta, useRelatedItems, useTeamDefaults, useWorkItem } from '@/lib/queries'
import { useCanEdit, useUi } from '@/lib/store'
import type { Identity, WorkItem } from '@/lib/types'
import { cn, formatDate, relativeTime } from '@/lib/utils'
import { useWatch } from '@/lib/watch'
import { EditableTitle, EditableValue, MarkdownEditor, NumberField, PersonSelect, RichEditor, Select, TagEditor, type Option } from './editors'
import { htmlToMarkdown } from '@/lib/richtext'
import { RichText } from './RichText'
import { TemplatePicker } from './Templates'
import { Avatar, Button, ErrorState, Skeleton, StatePill, TypeIcon } from './ui'

const RICH_FIELDS: [string, string][] = [
  ['System.Description', 'Description'],
  ['Microsoft.VSTS.TCM.ReproSteps', 'Repro steps'],
  ['Microsoft.VSTS.Common.AcceptanceCriteria', 'Acceptance criteria'],
  ['Microsoft.VSTS.TCM.SystemInfo', 'System info']
]

const PRIORITY = 'Microsoft.VSTS.Common.Priority'
const COMPLETED = 'Microsoft.VSTS.Scheduling.CompletedWork'

const idFromUrl = (url: string) => Number(url.split('/').pop())

export function WorkItemDrawer() {
  const id = useUi((s) => s.drawerId)
  const openItem = useUi((s) => s.openItem)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (e.key !== 'Escape' || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      if ((el as HTMLElement | null)?.isContentEditable) return
      // An open image lightbox or popover handles Escape itself.
      if (!document.querySelector('[data-lightbox], [data-popover-open], [data-dialog-open]')) openItem(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openItem])

  if (id === null) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="animate-fade-in absolute inset-0 bg-black/10 dark:bg-black/40" onClick={() => openItem(null)} />
      <div className="animate-slide-in relative flex h-full w-[min(760px,92vw)] flex-col border-l border-line bg-surface shadow-pop">
        <DrawerBody key={id} id={id} />
      </div>
    </div>
  )
}

function DrawerBody({ id }: { id: number }) {
  const meta = useMeta().data
  const connection = useUi((s) => s.connection)!
  const openItem = useUi((s) => s.openItem)
  const openCreate = useUi((s) => s.openCreate)
  const canEdit = useCanEdit()
  const item = useWorkItem(id)
  const comments = useComments(id)
  const iterations = useIterations().data ?? []
  const defaults = useTeamDefaults().data
  const update = useUpdateWorkItem()
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)

  // Opening an item counts as having seen its inbox updates.
  useEffect(() => useWatch.getState().markRead(id), [id])

  const rel = item.data?.relations ?? []
  const parentIds = rel.filter((r) => r.rel === 'System.LinkTypes.Hierarchy-Reverse').map((r) => idFromUrl(r.url))
  const childIds = rel.filter((r) => r.rel === 'System.LinkTypes.Hierarchy-Forward').map((r) => idFromUrl(r.url))
  const relatedIds = rel.filter((r) => r.rel === 'System.LinkTypes.Related').map((r) => idFromUrl(r.url))
  const artifacts = rel.filter((r) => r.rel === 'ArtifactLink')
  const linked = useRelatedItems([...parentIds, ...childIds, ...relatedIds], meta)
  const linkedById = useMemo(() => new Map((linked.data ?? []).map((w) => [w.id, w])), [linked.data])

  const f = item.data?.fields ?? {}
  const type = (f['System.WorkItemType'] as string) ?? ''
  const state = (f['System.State'] as string) ?? ''
  const tf = meta?.fieldMap
  const activity = useAllowedValues(type || undefined, tf?.activity && meta && typeHasField(meta, type, tf.activity) ? tf.activity : undefined)

  const url = workItemWebUrl(connection, id)
  const people = useMemo(
    () => [
      ...(comments.data ?? []).map((c) => c.createdBy),
      item.data?.fields['System.AssignedTo'] as Identity | undefined,
      item.data?.fields['System.CreatedBy'] as Identity | undefined
    ],
    [comments.data, item.data]
  )
  const knownTags = useMemo(() => {
    const all = new Set<string>()
    for (const [, d] of qc.getQueriesData<{ items?: WorkItem[] }>({})) for (const w of d?.items ?? []) w.tags.forEach((t) => all.add(t))
    return [...all].sort((a, b) => a.localeCompare(b))
  }, [qc])

  const copy = () => {
    void navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  if (item.error) return <ErrorState error={item.error} onRetry={() => item.refetch()} />

  /** Saves one field; `display` is the optimistic UI value when it differs from the wire value. */
  const save = (field: string, value: unknown, label: string, display?: unknown, extra?: Partial<FieldChange>) =>
    update.mutate({
      id,
      rev: item.data?.rev,
      label,
      changes: [{ field, value, display, prev: wireValue(field, f[field]), prevDisplay: f[field], ...extra }]
    })

  const tags = typeof f['System.Tags'] === 'string' ? (f['System.Tags'] as string).split(';').map((t) => t.trim()).filter(Boolean) : []
  const has = (field?: string) => !!meta && typeHasField(meta, type, field)
  const num = (k?: string) => (k && typeof f[k] === 'number' ? (f[k] as number) : undefined)

  const stateOptions: Option[] =
    meta?.types.get(type)?.states.map((s) => ({
      value: s.name,
      label: s.name,
      group: s.category === 'InProgress' ? 'In progress' : s.category,
      icon: <span className="size-2 rounded-full" style={{ background: `#${s.color}` }} />
    })) ?? []
  const iterationOptions: Option[] = [
    ...(defaults ? [{ value: defaults.backlogIterationPath, label: 'Backlog (no sprint)', group: 'Backlog' }] : []),
    ...iterations
      .filter((i) => i.attributes.timeFrame !== 'past' || i.path === f['System.IterationPath'])
      .map((i) => ({
        value: i.path,
        label: i.name,
        group: i.attributes.timeFrame === 'current' ? 'Current' : i.attributes.timeFrame === 'future' ? 'Upcoming' : 'Past',
        hint: i.attributes.startDate ? formatDate(i.attributes.startDate) : undefined
      }))
  ]
  const iterationPath = (f['System.IterationPath'] as string) ?? ''
  const iterationLabel = iterations.find((i) => i.path === iterationPath)?.name ?? (iterationPath.split('\\').slice(1).join(' / ') || iterationPath)

  return (
    <>
      <div className="drag flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        {meta && type && <TypeIcon meta={meta} type={type} />}
        <span className="text-[12px] font-medium text-muted">
          {type} <span className="font-mono text-faint">{id}</span>
        </span>
        {update.isPending && <span className="text-[11px] text-faint">Saving…</span>}
        <div className="flex-1" />
        <div className="no-drag flex items-center gap-0.5">
          {item.data && (
            <SubscribeButton
              id={id}
              rev={item.data.rev}
              title={f['System.Title'] as string}
              type={type}
              state={state}
            />
          )}
          <IconBtn onClick={copy} title="Copy link">
            {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
          </IconBtn>
          <IconBtn onClick={() => window.ado.openExternal(url)} title="Open in Azure DevOps">
            <ArrowUpRight size={15} />
          </IconBtn>
          <IconBtn onClick={() => openItem(null)} title="Close  (Esc)">
            <X size={15} />
          </IconBtn>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {item.isPending || !meta ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-6 h-32" />
          </div>
        ) : (
          <div className="p-6">
            <div className="mb-1 h-1 w-10 rounded-full" style={{ background: typeColor(meta, type) }} />
            <EditableTitle value={f['System.Title'] as string} disabled={!canEdit} onSave={(v) => save('System.Title', v, 'Title updated')} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {canEdit ? (
                <Select
                  value={state}
                  options={stateOptions}
                  width={220}
                  onChange={(v) => v !== state && save('System.State', v, `State → ${v}`)}
                  trigger={(open) => (
                    <span className={cn('inline-flex rounded-full', open && 'ring-2 ring-[var(--ring)]')}>
                      <StatePill meta={meta} type={type} state={state} className="cursor-pointer hover:border-line-strong" />
                    </span>
                  )}
                />
              ) : (
                <StatePill meta={meta} type={type} state={state} />
              )}
              {typeof f['System.BoardColumn'] === 'string' && f['System.BoardColumn'] !== state && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">Board: {f['System.BoardColumn'] as string}</span>
              )}
              <TagEditor
                tags={tags}
                disabled={!canEdit}
                suggestions={knownTags}
                onChange={(next) => save('System.Tags', next.join('; '), next.length > tags.length ? `Tag “${next.at(-1)}” added` : 'Tag removed')}
              />
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-line bg-surface-2/50 p-4">
              <Prop label="Assigned to">
                <PersonSelect
                  value={f['System.AssignedTo'] as Identity | undefined}
                  disabled={!canEdit}
                  onChange={(who) =>
                    save('System.AssignedTo', identityValue(who), who ? `Assigned to ${who.displayName}` : 'Unassigned', who ?? undefined)
                  }
                />
              </Prop>
              <Prop label="Iteration">
                {canEdit ? (
                  <Select
                    bleed
                    value={iterationPath}
                    options={iterationOptions}
                    width={300}
                    placeholder="Search sprints…"
                    onChange={(v) =>
                      v !== iterationPath && save('System.IterationPath', v, `Moved to ${iterationOptions.find((o) => o.value === v)?.label ?? v}`)
                    }
                    trigger={(open) => <EditableValue open={open}>{iterationLabel || '—'}</EditableValue>}
                  />
                ) : (
                  iterationLabel || '—'
                )}
              </Prop>
              <Prop label="Area">
                <span className="truncate" title={f['System.AreaPath'] as string}>
                  {(f['System.AreaPath'] as string)?.split('\\').slice(1).join(' / ') || (f['System.AreaPath'] as string)}
                </span>
              </Prop>
              {has(PRIORITY) && (
                <Prop label="Priority">
                  {canEdit ? (
                    <Select
                      bleed
                      value={num(PRIORITY) !== undefined ? String(num(PRIORITY)) : undefined}
                      options={['1', '2', '3', '4'].map((p) => ({ value: p, label: `Priority ${p}`, hint: p === '1' ? 'highest' : p === '4' ? 'lowest' : undefined }))}
                      width={180}
                      onChange={(v) => save(PRIORITY, Number(v), `Priority → ${v}`)}
                      trigger={(open) => <EditableValue open={open}>{num(PRIORITY) ?? '—'}</EditableValue>}
                    />
                  ) : (
                    (num(PRIORITY) ?? '—')
                  )}
                </Prop>
              )}
              {has(tf?.effort) && (
                <Prop label="Effort">
                  <NumberField value={num(tf?.effort)} disabled={!canEdit} onSave={(v) => save(tf!.effort!, v, v === null ? 'Effort cleared' : `Effort → ${v}`)} />
                </Prop>
              )}
              {has(tf?.remaining) && (
                <Prop label="Remaining work">
                  <NumberField
                    value={num(tf?.remaining)}
                    suffix="h"
                    disabled={!canEdit}
                    onSave={(v) => save(tf!.remaining!, v, v === null ? 'Remaining cleared' : `Remaining → ${v}h`)}
                  />
                </Prop>
              )}
              {has(COMPLETED) && (num(COMPLETED) !== undefined || isTaskLevel(meta, { type } as WorkItem)) && (
                <Prop label="Completed work">
                  <NumberField value={num(COMPLETED)} suffix="h" disabled={!canEdit} onSave={(v) => save(COMPLETED, v, `Completed → ${v ?? 0}h`)} />
                </Prop>
              )}
              {has(tf?.activity) && (
                <Prop label="Activity">
                  {canEdit && (activity.data?.length ?? 0) > 0 ? (
                    <Select
                      bleed
                      value={(f[tf!.activity!] as string) ?? undefined}
                      options={[{ value: '', label: 'None' }, ...activity.data!.map((a) => ({ value: a, label: a }))]}
                      width={220}
                      onChange={(v) => save(tf!.activity!, v, v ? `Activity → ${v}` : 'Activity cleared')}
                      trigger={(open) => (
                        <EditableValue open={open}>{(f[tf!.activity!] as string) || <span className="text-faint">—</span>}</EditableValue>
                      )}
                    />
                  ) : (
                    ((f[tf!.activity!] as string) ?? '—')
                  )}
                </Prop>
              )}
              <Prop label="Created">
                <span title={f['System.CreatedDate'] as string}>
                  {formatDate(f['System.CreatedDate'] as string, { day: 'numeric', month: 'short', year: 'numeric' })} by{' '}
                  {(f['System.CreatedBy'] as Identity | undefined)?.displayName}
                </span>
              </Prop>
              <Prop label="Updated">
                {relativeTime(f['System.ChangedDate'] as string)} by {(f['System.ChangedBy'] as Identity | undefined)?.displayName}
              </Prop>
            </dl>

            {RICH_FIELDS.filter(([k]) => (typeof f[k] === 'string' && (f[k] as string).trim()) || (canEdit && has(k) && k !== 'Microsoft.VSTS.TCM.SystemInfo')).map(
              ([k, label]) => (
                <RichSection
                  key={k}
                  label={label}
                  value={(f[k] as string) ?? ''}
                  format={item.data?.multilineFieldsFormat?.[k]}
                  people={people}
                  canEdit={canEdit}
                  saving={update.isPending}
                  templates={k === 'System.Description' ? { type, title: f['System.Title'] as string } : undefined}
                  onSave={(v, format) =>
                    update.mutate({
                      id,
                      rev: item.data?.rev,
                      label: `${label} updated`,
                      changes: [{ field: k, value: v, prev: f[k] }],
                      extraOps: format === 'markdown' ? [{ op: 'add', path: `/multilineFieldsFormat/${k}`, value: 'Markdown' }] : undefined
                    })
                  }
                />
              )
            )}

            <Section
              title="Links"
              icon={<Link2 size={13} />}
              action={
                canEdit && (
                  <Button className="h-6 text-[11.5px]" onClick={() => openCreate({ parentId: id, iterationPath })}>
                    <Plus size={12} /> Add child
                  </Button>
                )
              }
            >
              {parentIds.length + childIds.length + relatedIds.length === 0 && <div className="text-[12.5px] text-faint">No linked work items.</div>}
              <LinkGroup label="Parent" ids={parentIds} byId={linkedById} meta={meta} onOpen={openItem} />
              <LinkGroup label="Children" ids={childIds} byId={linkedById} meta={meta} onOpen={openItem} />
              <LinkGroup label="Related" ids={relatedIds} byId={linkedById} meta={meta} onOpen={openItem} />
            </Section>
            {artifacts.length > 0 && (
              <div className="mt-3 flex items-center gap-1.5 text-[12px] text-faint">
                <GitBranch size={13} /> {artifacts.length} development link{artifacts.length > 1 && 's'} (branches, commits, PRs)
              </div>
            )}

            <Section title={`Discussion${comments.data ? ` · ${comments.data.length}` : ''}`} icon={<MessageCircle size={13} />}>
              {canEdit && <CommentComposer id={id} people={people} />}
              {comments.isPending && <Skeleton className="h-16" />}
              {comments.data?.length === 0 && <div className="text-faint">No comments yet.</div>}
              <div className="space-y-4">
                {comments.data?.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <Avatar who={c.createdBy} size={26} />
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 text-[12px]">
                        <span className="font-semibold">{c.createdBy.displayName}</span>
                        <span className="ml-2 text-faint">{relativeTime(c.createdDate)}</span>
                      </div>
                      <RichText
                        className="rounded-lg bg-surface-2/60 px-3.5 py-2.5"
                        value={c.renderedText || c.text}
                        format={c.renderedText ? 'html' : c.format}
                        people={people}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}
      </div>
    </>
  )
}

/** Wire value of a field as currently stored, for undo/remove decisions. */
function wireValue(field: string, v: unknown): unknown {
  if (field === 'System.AssignedTo') return identityValue(v as Identity | undefined)
  return v
}

function RichSection({
  label,
  value,
  format,
  people,
  canEdit,
  saving,
  onSave,
  templates
}: {
  label: string
  value: string
  format?: string
  people: (Identity | undefined)[]
  canEdit: boolean
  saving: boolean
  onSave(v: string, format?: string): void
  /** Offer local description templates (type/title fill the template's placeholders). */
  templates?: { type: string; title: string }
}) {
  /** `null` = not editing; otherwise the text the editor starts with. */
  const [start, setStart] = useState<string | null>(null)
  const [richText, setRichText] = useState(false)
  const isHtml = !!value.trim() && format !== 'markdown'
  // Editing always happens in markdown; HTML content is converted when the editor opens.
  const markdown = useMemo(() => (isHtml && start !== null ? htmlToMarkdown(value) : value), [isHtml, start, value])

  const close = () => (setStart(null), setRichText(false))
  const picker = templates
    ? (replace: (md: string) => void) => <TemplatePicker type={templates.type} title={templates.title} onApply={replace} />
    : undefined

  return (
    <Section
      title={label}
      action={
        canEdit &&
        start === null &&
        value.trim() && (
          <Button className="h-6 text-[11.5px]" onClick={() => setStart(value)}>
            <Pencil size={11} /> Edit
          </Button>
        )
      }
    >
      {start !== null && richText ? (
        <RichEditor
          value={value}
          format="html"
          saving={saving}
          onCancel={close}
          onSave={(v) => {
            close()
            if (v !== value) onSave(v)
          }}
        />
      ) : start !== null ? (
        <MarkdownEditor
          value={value.trim() ? markdown : start}
          saving={saving}
          placeholder={`Add ${label.toLowerCase()} in Markdown…`}
          people={people}
          toolbarExtra={picker}
          notice={
            isHtml && (
              <>
                Converted from rich text. Saving stores this field as <b>Markdown</b> — Azure DevOps can’t convert it back.{' '}
                <button className="font-medium text-accent-fg hover:underline" onClick={() => setRichText(true)}>
                  Edit as rich text instead
                </button>
              </>
            )
          }
          onCancel={close}
          onSave={(v) => {
            close()
            if (v !== value || isHtml) onSave(v, 'markdown')
          }}
        />
      ) : value.trim() ? (
        <div onDoubleClick={() => canEdit && setStart(value)}>
          <RichText value={value} format={format} people={people} />
        </div>
      ) : (
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => setStart('')}
            className="flex-1 rounded-lg border border-dashed border-line-strong px-3 py-3 text-left text-[12.5px] text-faint hover:border-accent hover:text-accent-fg"
          >
            Add {label.toLowerCase()}…
          </button>
          {templates && (
            <span className="grid place-items-center rounded-lg border border-dashed border-line-strong px-1.5 hover:border-accent">
              <TemplatePicker type={templates.type} title={templates.title} onApply={(md) => setStart(md)} />
            </span>
          )}
        </div>
      )}
    </Section>
  )
}

function CommentComposer({ id, people }: { id: number; people: (Identity | undefined)[] }) {
  const add = useAddComment(id)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState(0)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 flex w-full items-center gap-2 rounded-lg border border-line bg-surface-2/40 px-3 py-2.5 text-left text-[12.5px] text-faint hover:border-line-strong"
      >
        <MessageCircle size={14} /> Add a comment…
      </button>
    )
  }
  return (
    <div className="mb-4">
      <MarkdownEditor
        key={key}
        compact
        value=""
        saving={add.isPending}
        placeholder="Comment in Markdown… @ mentions people"
        people={people}
        onCancel={() => setOpen(false)}
        onSave={(text) => {
          if (!text.trim()) return
          add.mutate(text, {
            onSuccess: () => {
              setOpen(false)
              setKey((k) => k + 1)
            }
          })
        }}
      />
    </div>
  )
}

function SubscribeButton({ id, ...item }: { id: number; rev: number; title: string; type: string; state: string }) {
  const sub = useWatch((s) => s.subs[id])
  const title = !sub
    ? 'Subscribe: get notified when others change this item'
    : sub.source === 'auto'
      ? 'Subscribed because you created it. Click to unsubscribe.'
      : 'Subscribed. Click to unsubscribe.'
  return (
    <button
      onClick={() => (sub ? useWatch.getState().unsubscribe(id) : useWatch.getState().subscribe({ id, ...item }))}
      title={title}
      className={cn(
        'flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium',
        sub ? 'text-accent-fg hover:bg-surface-2' : 'text-faint hover:bg-surface-2 hover:text-fg'
      )}
    >
      {sub ? <Bell size={14} className="fill-current" /> : <BellOff size={14} />}
      {sub ? 'Subscribed' : 'Subscribe'}
    </button>
  )
}

const IconBtn = ({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...p} className="rounded-md p-1.5 text-faint hover:bg-surface-2 hover:text-fg">
    {children}
  </button>
)

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-0.5 text-[11px] font-medium text-faint">{label}</dt>
      <dd className="min-h-6 truncate text-[12.5px] select-text">{children}</dd>
    </div>
  )
}

function Section({ title, icon, action, children }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h3 className="mb-2.5 flex h-6 items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-faint uppercase">
        {icon}
        {title}
        <span className="flex-1" />
        <span className="normal-case tracking-normal">{action}</span>
      </h3>
      {children}
    </section>
  )
}

function LinkGroup({
  label,
  ids,
  byId,
  meta,
  onOpen
}: {
  label: string
  ids: number[]
  byId: Map<number, WorkItem>
  meta: Meta
  onOpen(id: number): void
}) {
  if (!ids.length) return null
  return (
    <div className="mb-3">
      <div className="mb-1 text-[11px] text-faint">{label}</div>
      <div className="overflow-hidden rounded-lg border border-line">
        {ids.map((lid) => {
          const w = byId.get(lid)
          return (
            <button
              key={lid}
              onClick={() => onOpen(lid)}
              className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left last:border-b-0 hover:bg-surface-2"
            >
              {w ? <TypeIcon meta={meta} type={w.type} /> : <span className="size-3.5" />}
              <span className="font-mono text-[11px] text-faint">{lid}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px]">{w?.title ?? <Skeleton className="h-3 w-40" />}</span>
              {w && <StatePill meta={meta} type={w.type} state={w.state} />}
              {w && (
                <span className="text-[11px] text-faint" title={stateInfo(meta, w.type, w.state).category}>
                  <Avatar who={w.assignedTo} size={18} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

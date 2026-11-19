import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import type { Meta } from '@/lib/model'
import { typeHasField } from '@/lib/model'
import { identityValue, useCreateWorkItem } from '@/lib/mutations'
import { useIterations, useMeta, useRelatedItems, useTeamDefaults } from '@/lib/queries'
import { useUi, type CreateRequest } from '@/lib/store'
import type { Identity, WorkItem } from '@/lib/types'
import { cn, formatDate } from '@/lib/utils'
import { EditableValue, PersonSelect, Select, TagEditor, type Option } from './editors'
import { RichText } from './RichText'
import { TemplatePicker } from './Templates'
import { Button, Kbd, TypeIcon } from './ui'

/** Backlog levels top-down including the task level, as lists of type names. */
function levelTypes(meta: Meta): string[][] {
  return [...meta.levels.map((l) => l.workItemTypes.map((t) => t.name)), meta.config.taskBacklog.workItemTypes.map((t) => t.name)]
}

const levelOf = (meta: Meta, type: string) => levelTypes(meta).findIndex((l) => l.includes(type))

/** Types that can be children of `parentType` (the next level down). */
export function childTypesOf(meta: Meta, parentType: string): string[] {
  const lv = levelTypes(meta)
  const i = levelOf(meta, parentType)
  return i >= 0 && i < lv.length - 1 ? lv[i + 1] : []
}

export function CreateDialog() {
  const request = useUi((s) => s.create)
  const close = () => useUi.getState().openCreate(null)
  const meta = useMeta().data
  if (!request || !meta) return null
  return (
    <div
      data-dialog-open
      className="fixed inset-0 z-50 grid place-items-start justify-center overflow-y-auto bg-black/30 p-6 pt-[8vh] backdrop-blur-sm"
      onMouseDown={close}
    >
      <div className="animate-pop-in w-full max-w-[640px]" onMouseDown={(e) => e.stopPropagation()}>
        <CreateForm request={request} meta={meta} onClose={close} />
      </div>
    </div>
  )
}

function CreateForm({ request, meta, onClose }: { request: CreateRequest; meta: Meta; onClose(): void }) {
  const ui = useUi()
  const qc = useQueryClient()
  const iterations = useIterations().data ?? []
  const defaults = useTeamDefaults().data
  const create = useCreateWorkItem()
  const preset = useRelatedItems(request.parentId !== undefined ? [request.parentId] : [], meta).data?.[0]

  // Items already loaded anywhere, for picking a parent.
  const cached = useMemo(() => {
    const m = new Map<number, WorkItem>()
    for (const [, d] of qc.getQueriesData<{ items?: WorkItem[]; outsideParents?: WorkItem[]; ancestors?: WorkItem[] }>({})) {
      for (const w of [...(d?.items ?? []), ...(d?.outsideParents ?? []), ...(d?.ancestors ?? [])]) m.set(w.id, w)
    }
    return [...m.values()]
  }, [qc])

  const currentSprint = iterations.find((i) => i.id === ui.iterationId)
  const viewLevel = meta.levels.find((l) => l.id === ui.backlogLevelId)
  const allowedTypes = useMemo(() => {
    if (preset) return childTypesOf(meta, preset.type)
    return levelTypes(meta).flat()
  }, [meta, preset])
  const defaultType =
    request.type ??
    (preset ? childTypesOf(meta, preset.type)[0] : undefined) ??
    (ui.view === 'backlog' ? (viewLevel?.defaultWorkItemType?.name ?? viewLevel?.workItemTypes[0]?.name) : undefined) ??
    meta.config.requirementBacklog.defaultWorkItemType?.name ??
    allowedTypes[0]

  const [type, setType] = useState(defaultType)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [beforeTemplate, setBeforeTemplate] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [assignee, setAssignee] = useState<Identity | null>(null)
  const [iterationPath, setIterationPath] = useState<string>('')
  const [areaPath, setAreaPath] = useState<string>('')
  const [parentId, setParentId] = useState<number | undefined>(request.parentId)
  const [effort, setEffort] = useState('')
  const [remaining, setRemaining] = useState('')
  const [priority, setPriority] = useState('2')
  const [tags, setTags] = useState<string[]>([])
  const [extra, setExtra] = useState<Record<string, string>>({})
  const [another, setAnother] = useState(false)

  /** Once the user changes iteration/area, the parent no longer overrides them. */
  const [iterationEdited, setIterationEdited] = useState(false)
  const [areaEdited, setAreaEdited] = useState(false)

  useEffect(() => {
    if (preset && !allowedTypes.includes(type)) setType(allowedTypes[0])
  }, [preset, allowedTypes, type])

  const parent = parentId !== undefined ? (cached.find((w) => w.id === parentId) ?? (preset?.id === parentId ? preset : undefined)) : undefined

  // Pre-fill iteration and area from the parent (when there is one), else from the context/team
  // defaults. Parent and defaults load asynchronously, so this re-runs until the user edits a field.
  const fallbackIteration =
    request.iterationPath || (ui.view === 'board' ? currentSprint?.path : undefined) || defaults?.backlogIterationPath || ''
  useEffect(() => {
    if (!iterationEdited) setIterationPath(parent?.iterationPath || fallbackIteration)
  }, [parent?.iterationPath, fallbackIteration, iterationEdited])
  useEffect(() => {
    if (!areaEdited) setAreaPath(parent?.areaPath || defaults?.areaPath || '')
  }, [parent?.areaPath, defaults?.areaPath, areaEdited])
  const fromParent = (value: string, edited: boolean, parentValue?: string) =>
    !!parent && !edited && !!value && value === parentValue ? `from #${parent.id}` : undefined

  const has = (f?: string) => typeHasField(meta, type, f)
  const fm = meta.fieldMap
  const parentTypes = (() => {
    const lv = levelTypes(meta)
    const i = levelOf(meta, type)
    return i > 0 ? lv[i - 1] : []
  })()
  // Required fields the dialog has no dedicated input for (e.g. a custom Severity). System fields are
  // excluded: ADO reports some as always required (Area ID, Iteration ID, ID…) but derives them itself.
  const requiredExtras = (meta.types.get(type)?.fields ?? []).filter(
    (f) =>
      f.alwaysRequired &&
      !f.referenceName.startsWith('System.') &&
      f.defaultValue == null &&
      ![fm.effort, fm.remaining, 'Microsoft.VSTS.Common.Priority'].includes(f.referenceName)
  )

  const typeOptions: Option[] = allowedTypes.map((t) => ({ value: t, label: t, icon: <TypeIcon meta={meta} type={t} /> }))
  const iterationOptions: Option[] = [
    ...(defaults ? [{ value: defaults.backlogIterationPath, label: 'Backlog (no sprint)', group: 'Backlog' }] : []),
    ...iterations
      .filter((i) => i.attributes.timeFrame !== 'past')
      .map((i) => ({
        value: i.path,
        label: i.name,
        group: i.attributes.timeFrame === 'current' ? 'Current' : 'Upcoming',
        hint: i.attributes.startDate ? formatDate(i.attributes.startDate) : undefined
      }))
  ]
  // The parent's iteration may be a past sprint or the project root; keep it selectable.
  if (iterationPath && !iterationOptions.some((o) => o.value === iterationPath)) {
    iterationOptions.unshift({
      value: iterationPath,
      label: iterationPath.split('\\').slice(1).join(' / ') || iterationPath,
      group: parent && iterationPath === parent.iterationPath ? 'Parent’s iteration' : 'Current value'
    })
  }
  const parentOptions: Option[] = [
    { value: '', label: 'No parent' },
    ...cached
      .filter((w) => parentTypes.includes(w.type))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((w) => ({ value: String(w.id), label: w.title, hint: `#${w.id}`, icon: <TypeIcon meta={meta} type={w.type} /> }))
  ]

  const missing = !title.trim() || requiredExtras.some((f) => !extra[f.referenceName]?.trim())
  const submit = () => {
    if (missing || create.isPending) return
    const n = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')))
    const fields: Record<string, unknown> = {
      'System.Title': title.trim(),
      'System.Description': description.trim() || undefined,
      'System.AssignedTo': identityValue(assignee) || undefined,
      'System.IterationPath': iterationPath || undefined,
      'System.AreaPath': areaPath || undefined,
      'System.Tags': tags.join('; ') || undefined,
      ...Object.fromEntries(requiredExtras.map((f) => [f.referenceName, extra[f.referenceName]]))
    }
    if (has('Microsoft.VSTS.Common.Priority')) fields['Microsoft.VSTS.Common.Priority'] = Number(priority)
    if (fm.effort && has(fm.effort)) fields[fm.effort] = n(effort)
    if (fm.remaining && has(fm.remaining)) fields[fm.remaining] = n(remaining)
    create.mutate(
      { type, fields, parentId, markdownFields: ['System.Description'], open: !another },
      {
        onSuccess: (res) => {
          if (another && !res.dryRun) {
            setTitle('')
            setDescription('')
            setBeforeTemplate(null)
            setRemaining('')
            setEffort('')
            document.getElementById('create-title')?.focus()
          } else if (!res.dryRun) onClose()
        }
      }
    )
  }

  return (
    <div
      className="overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), submit())
        if (e.key === 'Escape' && !document.querySelector('[data-popover-open]')) (e.stopPropagation(), onClose())
      }}
    >
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <Select
          value={type}
          options={typeOptions}
          width={240}
          onChange={setType}
          trigger={(open) => (
            <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-semibold hover:bg-surface-2', open && 'bg-surface-2')}>
              <TypeIcon meta={meta} type={type} /> New {type}
            </span>
          )}
        />
        {parent && (
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-faint">
            under <TypeIcon meta={meta} type={parent.type} size={12} />
            <span className="truncate">{parent.title}</span>
          </span>
        )}
        <span className="flex-1" />
        <button onClick={onClose} className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-fg">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-4 px-5 py-4">
        <input
          id="create-title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full bg-transparent text-[18px] font-semibold tracking-tight outline-none select-text placeholder:text-faint"
        />

        <div className="rounded-lg border border-line focus-within:border-accent">
          <div className="flex items-center gap-1 border-b border-line px-2 py-1 text-[12px]">
            <button className={cn('rounded px-2 py-0.5', !preview ? 'bg-surface-2 font-medium' : 'text-faint')} onClick={() => setPreview(false)}>
              Write
            </button>
            <button className={cn('rounded px-2 py-0.5', preview ? 'bg-surface-2 font-medium' : 'text-faint')} onClick={() => setPreview(true)}>
              Preview
            </button>
            <span className="flex-1" />
            {beforeTemplate !== null && (
              <button className="rounded px-2 py-0.5 text-faint hover:text-fg" onClick={() => (setDescription(beforeTemplate), setBeforeTemplate(null))}>
                Undo template
              </button>
            )}
            <TemplatePicker
              type={type}
              title={title}
              onApply={(md) => {
                setBeforeTemplate(description)
                setDescription(md)
                setPreview(false)
              }}
            />
          </div>
          {preview ? (
            <div className="min-h-24 px-3 py-2">{description.trim() ? <RichText value={description} format="markdown" /> : <span className="text-faint">Nothing to preview</span>}</div>
          ) : (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description in Markdown (optional) — or pick a template"
              rows={description.split('\n').length > 6 ? 12 : 4}
              className="block w-full resize-y bg-transparent px-3 py-2 text-[13px] leading-relaxed outline-none select-text placeholder:text-faint"
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-line bg-surface-2/50 p-4 text-[12.5px]">
          <Field label="Assigned to">
            <PersonSelect value={assignee} onChange={setAssignee} />
          </Field>
          <Field label="Iteration" hint={fromParent(iterationPath, iterationEdited, parent?.iterationPath)}>
            <Select
              bleed
              value={iterationPath}
              options={iterationOptions}
              width={300}
              onChange={(v) => (setIterationPath(v), setIterationEdited(true))}
              trigger={(open) => (
                <EditableValue open={open}>
                  {iterationOptions.find((o) => o.value === iterationPath)?.label ?? (iterationPath.split('\\').slice(1).join(' / ') || iterationPath || '—')}
                </EditableValue>
              )}
            />
          </Field>
          <Field label="Parent">
            <Select
              bleed
              value={parentId !== undefined ? String(parentId) : ''}
              options={parentOptions}
              width={380}
              placeholder="Search loaded items…"
              onChange={(v) => setParentId(v ? Number(v) : undefined)}
              trigger={(open) => <EditableValue open={open}>{parent ? `#${parent.id} ${parent.title}` : <span className="text-faint">None</span>}</EditableValue>}
            />
          </Field>
          <Field label="Area" hint={fromParent(areaPath, areaEdited, parent?.areaPath)}>
            <input
              value={areaPath}
              title={areaPath}
              onChange={(e) => (setAreaPath(e.target.value), setAreaEdited(true))}
              className="-mx-1.5 w-full rounded-md bg-transparent px-1.5 py-0.5 outline-none select-text hover:bg-surface-3 focus:bg-surface focus:ring-2 focus:ring-[var(--ring)]"
            />
          </Field>
          {has('Microsoft.VSTS.Common.Priority') && (
            <Field label="Priority">
              <Select
                bleed
                value={priority}
                options={['1', '2', '3', '4'].map((p) => ({ value: p, label: `Priority ${p}` }))}
                width={160}
                onChange={setPriority}
                trigger={(open) => <EditableValue open={open}>{priority}</EditableValue>}
              />
            </Field>
          )}
          {fm.effort && has(fm.effort) && (
            <Field label="Effort">
              <NumInput value={effort} onChange={setEffort} />
            </Field>
          )}
          {fm.remaining && has(fm.remaining) && (
            <Field label="Remaining work (h)">
              <NumInput value={remaining} onChange={setRemaining} />
            </Field>
          )}
          {requiredExtras.map((f) => (
            <Field key={f.referenceName} label={`${f.name} *`}>
              <input
                value={extra[f.referenceName] ?? ''}
                onChange={(e) => setExtra({ ...extra, [f.referenceName]: e.target.value })}
                className="-mx-1.5 w-full rounded-md bg-surface px-1.5 py-0.5 outline-none select-text ring-1 ring-line focus:ring-2 focus:ring-[var(--ring)]"
              />
            </Field>
          ))}
          <Field label="Tags" wide>
            <TagEditor tags={tags} onChange={setTags} />
          </Field>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-line bg-surface-2/40 px-5 py-3">
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} className="accent-[var(--accent)]" />
          Create more
        </label>
        {ui.writeMode === 'validate' && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">Validate only</span>
        )}
        <span className="flex-1" />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" className="h-8 px-3" disabled={missing || create.isPending} onClick={submit}>
          {create.isPending ? 'Creating…' : `Create ${type}`} <Kbd>⌘↵</Kbd>
        </Button>
      </div>
    </div>
  )
}

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-2')}>
      <div className="mb-0.5 text-[11px] font-medium text-faint">
        {label}
        {hint && <span className="ml-1.5 font-normal text-accent-fg">· {hint}</span>}
      </div>
      <div className="min-h-6">{children}</div>
    </div>
  )
}

const NumInput = ({ value, onChange }: { value: string; onChange(v: string): void }) => (
  <input
    inputMode="decimal"
    value={value}
    onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
    placeholder="—"
    className="-mx-1.5 w-24 rounded-md bg-transparent px-1.5 py-0.5 tabular-nums outline-none select-text hover:bg-surface-3 focus:bg-surface focus:ring-2 focus:ring-[var(--ring)]"
  />
)

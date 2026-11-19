import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Plus,
  RemoveFormatting,
  X
} from 'lucide-react'
import { activeMention, matchPeople, mentionTokens, readableMentions, storableMentions } from '@/lib/mentions'
import { useIdentitySearch, useTeamMembers } from '@/lib/queries'
import { fromEditableHtml, toEditableHtml } from '@/lib/richtext'
import type { Identity, WorkItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { RichText } from './RichText'
import { Avatar, Button, Kbd, Popover, Tag } from './ui'

// ---- auto-growing textareas -----------------------------------------------------------

/** Scrollable ancestors, innermost first. */
function scrollParents(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) out.push(p)
  }
  return out
}

/**
 * Fits a textarea's height to its content (up to `max`, then it scrolls internally).
 *
 * Measuring needs a momentary `height: 0`, which shrinks the surrounding scroll container and makes
 * the browser clamp its scroll position — the page would jump to the top on every keystroke. So the
 * ancestors' scroll positions are restored in the same frame, and when typing on the last line the
 * nearest container scrolls just enough to keep that line visible.
 */
export function autosize(el: HTMLTextAreaElement, { min = 0, max = Infinity }: { min?: number; max?: number } = {}) {
  const parents = scrollParents(el)
  const tops = parents.map((p) => p.scrollTop)
  el.style.height = '0'
  const content = el.scrollHeight
  el.style.height = `${Math.min(Math.max(min, content), max)}px`
  el.style.overflowY = content > max ? 'auto' : 'hidden'
  parents.forEach((p, i) => (p.scrollTop = tops[i]))

  const container = parents[0]
  const onLastLine = !el.value.slice(el.selectionEnd).includes('\n')
  if (container && document.activeElement === el && onLastLine) {
    const overflow = el.getBoundingClientRect().bottom - (container.getBoundingClientRect().bottom - 24)
    if (overflow > 0) container.scrollTop += overflow
  }
}

// ---- inline title -------------------------------------------------------------------

export function EditableTitle({ value, onSave, disabled }: { value: string; onSave(v: string): void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => setDraft(value), [value])
  useLayoutEffect(() => {
    if (ref.current) autosize(ref.current)
  }, [draft, editing])

  const commit = () => {
    setEditing(false)
    const v = draft.trim()
    if (v && v !== value) onSave(v)
    else setDraft(value)
  }

  const cls = 'text-[19px] leading-snug font-semibold tracking-tight'
  if (!editing || disabled) {
    return (
      <h2
        className={cn(cls, 'rounded-md select-text', !disabled && '-mx-1.5 cursor-text px-1.5 hover:bg-surface-2')}
        onClick={() => !disabled && setEditing(true)}
        title={disabled ? undefined : 'Click to edit'}
      >
        {value}
      </h2>
    )
  }
  return (
    <textarea
      ref={ref}
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ' '))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') {
          e.stopPropagation()
          setDraft(value)
          setEditing(false)
        }
      }}
      className={cn(cls, '-mx-1.5 block w-[calc(100%+12px)] resize-none overflow-hidden rounded-md bg-surface-2 px-1.5 outline-none ring-2 ring-[var(--ring)] select-text')}
    />
  )
}

// ---- select -----------------------------------------------------------------------

export interface Option<T extends string = string> {
  value: T
  label: string
  icon?: ReactNode
  hint?: string
  group?: string
}

/** Searchable single-select popover with keyboard navigation. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  trigger,
  width = 260,
  placeholder = 'Search…',
  align,
  bleed
}: {
  value?: T
  options: Option<T>[]
  onChange(v: T): void
  trigger: (open: boolean) => ReactNode
  width?: number
  placeholder?: string
  align?: 'start' | 'end'
  /** Pull the trigger 6px left/right so its hover background lines up with surrounding text. */
  bleed?: boolean
}) {
  return (
    <Popover
      width={width}
      align={align}
      className={bleed ? '-mx-1.5' : undefined}
      trigger={(open, toggle) => (
        <button type="button" onClick={toggle} className="inline-flex max-w-full text-left">
          {trigger(open)}
        </button>
      )}
    >
      {(close) => <SelectList value={value} options={options} placeholder={placeholder} onPick={(v) => (close(), onChange(v))} />}
    </Popover>
  )
}

function SelectList<T extends string>({
  value,
  options,
  onPick,
  placeholder
}: {
  value?: T
  options: Option<T>[]
  onPick(v: T): void
  placeholder: string
}) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const t = q.toLowerCase()
    return options.filter((o) => !t || o.label.toLowerCase().includes(t) || o.hint?.toLowerCase().includes(t))
  }, [options, q])
  const [hi, setHi] = useState(() => Math.max(0, shown.findIndex((o) => o.value === value)))
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setHi((h) => Math.min(h, Math.max(0, shown.length - 1))), [shown.length])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${hi}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [hi])

  return (
    <div
      className="flex min-h-0 flex-col"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') (e.preventDefault(), setHi((h) => Math.min(h + 1, shown.length - 1)))
        if (e.key === 'ArrowUp') (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)))
        if (e.key === 'Enter' && shown[hi]) (e.preventDefault(), onPick(shown[hi].value))
      }}
    >
      {options.length > 7 && (
        <input
          autoFocus
          value={q}
          onChange={(e) => (setQ(e.target.value), setHi(0))}
          placeholder={placeholder}
          className="h-9 w-full border-b border-line bg-transparent px-3 text-[12.5px] outline-none select-text placeholder:text-faint"
        />
      )}
      <div ref={listRef} className="max-h-72 min-h-0 flex-1 overflow-y-auto p-1" tabIndex={options.length > 7 ? -1 : 0} autoFocus={options.length <= 7}>
        {shown.length === 0 && <div className="px-2 py-3 text-center text-faint">No matches</div>}
        {shown.map((o, i) => (
          <div key={o.value}>
            {o.group && o.group !== shown[i - 1]?.group && (
              <div className="px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-wide text-faint uppercase">{o.group}</div>
            )}
            <button
              type="button"
              data-idx={i}
              onMouseEnter={() => setHi(i)}
              onClick={() => onPick(o.value)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px]',
                i === hi && 'bg-surface-2',
                o.value === value && 'font-medium text-accent-fg'
              )}
            >
              {o.icon}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint && <span className="text-[11px] text-faint">{o.hint}</span>}
              {o.value === value && <Check size={13} />}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Trigger look shared by editable properties. */
export function EditableValue({ children, open, disabled }: { children: ReactNode; open?: boolean; disabled?: boolean }) {
  return (
    <span
      className={cn(
        'group/ev inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors',
        !disabled && 'hover:bg-surface-3',
        open && 'bg-surface-3'
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {!disabled && <ChevronDown size={12} className="shrink-0 text-faint opacity-0 group-hover/ev:opacity-100" />}
    </span>
  )
}

// ---- people ----------------------------------------------------------------------

/** Team members plus anyone already seen on loaded work items, deduplicated by uniqueName. */
export function useAssignablePeople(): Identity[] {
  const members = useTeamMembers().data
  const qc = useQueryClient()
  return useMemo(() => {
    const seen = new Map<string, Identity>()
    for (const m of members ?? []) seen.set((m.uniqueName ?? m.displayName).toLowerCase(), m)
    for (const [, data] of qc.getQueriesData<unknown>({})) {
      const d = data as { items?: WorkItem[] } | undefined
      for (const w of d?.items ?? []) {
        const a = w.assignedTo
        if (a) seen.set((a.uniqueName ?? a.displayName).toLowerCase(), seen.get((a.uniqueName ?? a.displayName).toLowerCase()) ?? a)
      }
    }
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [members, qc])
}

export function PersonSelect({
  value,
  onChange,
  disabled,
  trigger
}: {
  value?: Identity | null
  onChange(who: Identity | null): void
  disabled?: boolean
  trigger?: (open: boolean) => ReactNode
}) {
  const people = useAssignablePeople()
  const key = (p: Identity) => p.uniqueName ?? p.displayName
  const options: Option[] = [
    { value: '__none', label: 'Unassigned', icon: <Avatar who={null} size={18} /> },
    ...people.map((p) => ({ value: key(p), label: p.displayName, hint: p.uniqueName?.split('@')[0], icon: <Avatar who={p} size={18} /> }))
  ]
  const show = (open: boolean) =>
    trigger ? (
      trigger(open)
    ) : (
      <EditableValue open={open} disabled={disabled}>
        <span className="flex items-center gap-1.5">
          <Avatar who={value} size={18} />
          {value?.displayName ?? <span className="text-faint">Unassigned</span>}
        </span>
      </EditableValue>
    )
  if (disabled) return <>{show(false)}</>
  return (
    <Select
      bleed={!trigger}
      value={value ? key(value) : '__none'}
      options={options}
      width={300}
      placeholder="Search people…"
      onChange={(v) => onChange(v === '__none' ? null : (people.find((p) => key(p) === v) ?? null))}
      trigger={show}
    />
  )
}

// ---- number -----------------------------------------------------------------------

export function NumberField({
  value,
  onSave,
  suffix,
  disabled,
  placeholder = '—'
}: {
  value?: number
  onSave(v: number | null): void
  suffix?: string
  disabled?: boolean
  placeholder?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const display = value === undefined ? placeholder : `${value}${suffix ?? ''}`
  if (disabled) return <span>{display}</span>
  if (draft === null) {
    return (
      <button type="button" onClick={() => setDraft(value === undefined ? '' : String(value))} className="-mx-1.5 rounded-md px-1.5 py-0.5 text-left hover:bg-surface-3">
        <span className={cn(value === undefined && 'text-faint')}>{display}</span>
      </button>
    )
  }
  const commit = () => {
    const t = draft.trim().replace(',', '.')
    setDraft(null)
    const next = t === '' ? null : Number(t)
    if (next !== null && (!Number.isFinite(next) || next < 0)) return
    if ((next ?? undefined) !== value) onSave(next)
  }
  return (
    <input
      autoFocus
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') (e.stopPropagation(), setDraft(null))
      }}
      className="-mx-1.5 h-6 w-24 rounded-md bg-surface px-1.5 tabular-nums outline-none ring-2 ring-[var(--ring)] select-text"
    />
  )
}

// ---- tags -------------------------------------------------------------------------

export function TagEditor({
  tags,
  onChange,
  disabled,
  suggestions = [],
  addLabel = 'Tag'
}: {
  tags: string[]
  onChange(tags: string[]): void
  disabled?: boolean
  suggestions?: string[]
  /** Text of the add button. */
  addLabel?: string
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const matches = suggestions.filter((s) => !tags.includes(s) && s.toLowerCase().includes(draft.toLowerCase())).slice(0, 6)
  const add = (t: string) => {
    const v = t.trim()
    if (v && !tags.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...tags, v])
    setDraft('')
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span key={t} className="group/tag relative inline-flex">
          <Tag name={t} />
          {!disabled && (
            <button
              type="button"
              title={`Remove ${t}`}
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="absolute -top-1.5 -right-1.5 hidden size-3.5 place-items-center rounded-full bg-fg text-bg group-hover/tag:grid"
            >
              <X size={9} strokeWidth={3} />
            </button>
          )}
        </span>
      ))}
      {!disabled &&
        (adding ? (
          <span className="relative">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(';', ''))}
              onBlur={() => (add(draft), setAdding(false))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.preventDefault(), add(draft))
                if (e.key === 'Escape') (e.stopPropagation(), setDraft(''), setAdding(false))
                if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1))
              }}
              placeholder="Tag name"
              className="h-5 w-28 rounded border border-line bg-surface px-1.5 text-[11px] outline-none focus:border-accent select-text"
            />
            {draft && matches.length > 0 && (
              <span className="absolute top-full left-0 z-30 mt-1 w-44 rounded-md border border-line bg-surface p-1 shadow-pop">
                {matches.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onMouseDown={(e) => (e.preventDefault(), add(m))}
                    className="block w-full truncate rounded px-1.5 py-1 text-left text-[11.5px] hover:bg-surface-2"
                  >
                    {m}
                  </button>
                ))}
              </span>
            )}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-5 items-center gap-0.5 rounded border border-dashed border-line-strong px-1.5 text-[10.5px] text-faint hover:border-accent hover:text-accent-fg"
          >
            <Plus size={10} /> {addLabel}
          </button>
        ))}
    </span>
  )
}

// ---- rich text ----------------------------------------------------------------------

/**
 * Editor for a rich text field. Markdown fields get a Write/Preview markdown editor; HTML fields a
 * small WYSIWYG editor that preserves the existing HTML. ⌘↵ saves, Esc cancels.
 */
export function RichEditor({
  value,
  format,
  onSave,
  onCancel,
  saving,
  placeholder
}: {
  value: string
  format?: string
  onSave(v: string): void
  onCancel(): void
  saving?: boolean
  placeholder?: string
}) {
  return format === 'markdown' ? (
    <MarkdownEditor value={value} onSave={onSave} onCancel={onCancel} saving={saving} placeholder={placeholder} />
  ) : (
    <HtmlEditor value={value} onSave={onSave} onCancel={onCancel} saving={saving} placeholder={placeholder} />
  )
}

const editorKeys = (save: () => void, cancel: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), save())
  if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), cancel())
}

function EditorFooter({
  onSave,
  onCancel,
  saving,
  hint,
  extra
}: {
  onSave(): void
  onCancel(): void
  saving?: boolean
  hint: string
  extra?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 border-t border-line px-2 py-1.5">
      <span className="text-[11px] text-faint">{hint}</span>
      <span className="flex-1" />
      {extra}
      <Button onClick={onCancel}>Cancel</Button>
      <Button variant="primary" onClick={onSave} disabled={saving}>
        Save <Kbd>⌘↵</Kbd>
      </Button>
    </div>
  )
}

export function MarkdownEditor({
  value,
  onSave,
  onCancel,
  saving,
  placeholder,
  compact,
  toolbarExtra,
  notice,
  people = []
}: {
  value: string
  onSave(v: string): void
  onCancel(): void
  saving?: boolean
  placeholder?: string
  compact?: boolean
  /** Extra toolbar content; receives a function that replaces the draft (e.g. a template picker). */
  toolbarExtra?: (replace: (markdown: string) => void) => ReactNode
  /** Shown between toolbar and text, e.g. a format conversion hint. */
  notice?: ReactNode
  /** Extra people for @mentions besides the team (e.g. comment authors). */
  people?: (Identity | undefined)[]
}) {
  const assignable = useAssignablePeople()
  const known = useMemo(() => mentionable([...assignable, ...people]), [assignable, people])
  // The textarea shows `@Display Name`; `tokens` maps each name back to its `@<GUID>` for saving.
  const [initial] = useState(() => readableMentions(value, known))
  const tokens = useRef(initial.tokens)
  const storable = (text: string) => storableMentions(text, new Map([...mentionTokens(known), ...tokens.current]))
  const [draft, setDraft] = useState(initial.text)
  /** Draft before the last template was applied, so it can be restored. */
  const [beforeTemplate, setBeforeTemplate] = useState<string | null>(null)
  const replace = (markdown: string) => {
    setBeforeTemplate(draft)
    setDraft(markdown)
    setTab('write')
    requestAnimationFrame(() => ref.current?.focus())
  }
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    if (ref.current) autosize(ref.current, { min: compact ? 64 : 140, max: Math.round(window.innerHeight * 0.65) })
  }, [draft, tab, compact])

  /** Wraps the selection (or inserts at the caret) with markdown syntax. */
  const wrap = (before: string, after = before) => {
    const el = ref.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    const next = draft.slice(0, s) + before + draft.slice(s, e) + after + draft.slice(e)
    setDraft(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(s + before.length, e + before.length)
    })
  }
  const prefixLines = (prefix: string) => {
    const el = ref.current
    if (!el) return
    const s = draft.lastIndexOf('\n', el.selectionStart - 1) + 1
    const e = el.selectionEnd
    const block = draft.slice(s, e).split('\n').map((l) => prefix + l).join('\n')
    setDraft(draft.slice(0, s) + block + draft.slice(e))
    requestAnimationFrame(() => el.focus())
  }

  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  /** `@` position whose menu was closed with Escape; it stays closed until another `@` is typed. */
  const dismissed = useRef<number | null>(null)
  const trackMention = () => {
    const el = ref.current
    const m = el && el.selectionStart === el.selectionEnd ? activeMention(el.value, el.selectionStart) : null
    // Past the first word, keep the menu only while it still matches someone ("@team, please…" closes it).
    const stale = m && /\s/.test(m.query) && !matchPeople(known, m.query, 1).length
    setMention(m && !stale && m.start !== dismissed.current ? m : null)
  }
  const pickMention = (p: Identity & { id: string }) => {
    const el = ref.current
    if (!el || !mention) return
    const text = `@${p.displayName} `
    tokens.current.set(p.displayName, `@<${p.id.toUpperCase()}>`)
    setDraft(draft.slice(0, mention.start) + text + draft.slice(el.selectionStart))
    // The inserted name would read as a query again; this `@` is done.
    dismissed.current = mention.start
    setMention(null)
    const caret = mention.start + text.length
    requestAnimationFrame(() => (el.focus(), el.setSelectionRange(caret, caret)))
  }
  const menu = useRef<MentionMenuHandle>(null)

  const save = () => onSave(storable(draft))
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface focus-within:border-accent focus-within:ring-3 focus-within:ring-[var(--ring)]">
      <div className="flex items-center gap-0.5 border-b border-line px-1.5 py-1">
        <TabBtn active={tab === 'write'} onClick={() => setTab('write')}>
          Write
        </TabBtn>
        <TabBtn active={tab === 'preview'} onClick={() => setTab('preview')}>
          Preview
        </TabBtn>
        <span className="mx-1 h-4 w-px bg-line" />
        {tab === 'write' && (
          <>
            <ToolBtn title="Heading" onClick={() => prefixLines('## ')} icon={<Heading2 size={14} />} />
            <ToolBtn title="Bold (⌘B)" onClick={() => wrap('**')} icon={<Bold size={14} />} />
            <ToolBtn title="Italic (⌘I)" onClick={() => wrap('_')} icon={<Italic size={14} />} />
            <ToolBtn title="Code" onClick={() => wrap('`')} icon={<Code size={14} />} />
            <ToolBtn title="Link" onClick={() => wrap('[', '](https://)')} icon={<LinkIcon size={14} />} />
            <ToolBtn title="Bulleted list" onClick={() => prefixLines('- ')} icon={<List size={14} />} />
            <ToolBtn title="Numbered list" onClick={() => prefixLines('1. ')} icon={<ListOrdered size={14} />} />
          </>
        )}
        {toolbarExtra && (
          <>
            <span className="flex-1" />
            {toolbarExtra(replace)}
          </>
        )}
      </div>
      {notice && <div className="border-b border-line bg-amber-500/8 px-3 py-1.5 text-[11.5px] text-muted">{notice}</div>}
      {tab === 'write' ? (
        <textarea
          ref={ref}
          autoFocus
          value={draft}
          placeholder={placeholder ?? 'Write in Markdown… use #123 to reference work items, @ to mention people'}
          onChange={(e) => {
            setDraft(e.target.value)
            if (dismissed.current !== null && e.target.value[dismissed.current] !== '@') dismissed.current = null
            trackMention()
          }}
          onSelect={trackMention}
          onBlur={() => setMention(null)}
          onKeyDown={(e) => {
            if (mention && menu.current?.onKey(e)) return
            if (mention && e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              dismissed.current = mention.start
              return setMention(null)
            }
            editorKeys(save, onCancel)(e)
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') (e.preventDefault(), wrap('**'))
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') (e.preventDefault(), wrap('_'))
          }}
          className="block w-full resize-none bg-transparent px-3 py-2.5 font-sans text-[13.5px] leading-relaxed outline-none select-text placeholder:text-faint"
        />
      ) : (
        <div className="min-h-[140px] px-3 py-2.5">
          {draft.trim() ? <RichText value={storable(draft)} format="markdown" people={known} /> : <span className="text-faint">Nothing to preview</span>}
        </div>
      )}
      {tab === 'write' && mention && ref.current && (
        <MentionMenu ref={menu} textarea={ref.current} at={mention.start} query={mention.query} known={known} onPick={pickMention} />
      )}
      <EditorFooter
        onSave={save}
        onCancel={onCancel}
        saving={saving}
        hint="Markdown · #id links work items · @ mentions people"
        extra={
          beforeTemplate !== null && (
            <Button onClick={() => (setDraft(beforeTemplate), setBeforeTemplate(null))} title="Restore the text from before the template">
              Undo template
            </Button>
          )
        }
      />
    </div>
  )
}

// ---- @mentions --------------------------------------------------------------------

type Mentionable = Identity & { id: string }

/** People with an identity id (needed for a mention), first occurrence per id. */
function mentionable(people: (Identity | undefined)[]): Mentionable[] {
  const byId = new Map<string, Mentionable>()
  for (const p of people) if (p?.id && !byId.has(p.id.toLowerCase())) byId.set(p.id.toLowerCase(), p as Mentionable)
  return [...byId.values()]
}

/** Viewport position of the caret in a textarea, measured with an off-screen mirror of its text. */
function caretPosition(el: HTMLTextAreaElement, pos: number): { left: number; top: number; bottom: number } {
  const cs = getComputedStyle(el)
  const mirror = document.createElement('div')
  for (const prop of ['box-sizing', 'width', 'padding', 'border', 'font', 'letter-spacing', 'line-height', 'word-spacing', 'tab-size']) {
    mirror.style.setProperty(prop, cs.getPropertyValue(prop))
  }
  Object.assign(mirror.style, { position: 'fixed', left: '-9999px', top: '0', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' })
  mirror.textContent = el.value.slice(0, pos)
  const marker = mirror.appendChild(document.createElement('span'))
  marker.textContent = '​'
  document.body.appendChild(mirror)
  const r = el.getBoundingClientRect()
  const top = r.top + marker.offsetTop - el.scrollTop
  const left = r.left + marker.offsetLeft - el.scrollLeft
  const bottom = top + (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5)
  mirror.remove()
  return { left, top, bottom }
}

interface MentionMenuHandle {
  /** Handles navigation keys while the menu is open; true when the key was consumed. */
  onKey(e: React.KeyboardEvent): boolean
}

function MentionMenu({
  ref,
  textarea,
  at,
  query,
  known,
  onPick
}: {
  ref: React.Ref<MentionMenuHandle>
  textarea: HTMLTextAreaElement
  at: number
  query: string
  known: Mentionable[]
  onPick(p: Mentionable): void
}) {
  // People outside the team come from the identity search (needs Identity (Read)); typing is debounced.
  const [search, setSearch] = useState(query)
  useEffect(() => {
    const t = setTimeout(() => setSearch(query), 250)
    return () => clearTimeout(t)
  }, [query])
  const found = useIdentitySearch(search).data
  const options = useMemo(() => matchPeople(mentionable([...known, ...(found ?? [])]), query), [known, found, query])

  const [active, setActive] = useState(0)
  useEffect(() => setActive(0), [query])
  const current = options[Math.min(active, options.length - 1)]

  useImperativeHandle(ref, () => ({
    onKey(e) {
      if (!options.length) return false
      const move = (d: number) => (e.preventDefault(), setActive((i) => (Math.min(i, options.length - 1) + d + options.length) % options.length), true)
      if (e.key === 'ArrowDown') return move(1)
      if (e.key === 'ArrowUp') return move(-1)
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        onPick(current)
        return true
      }
      return false
    }
  }))

  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  useLayoutEffect(() => {
    const place = () => {
      const c = caretPosition(textarea, at)
      const width = 300
      const left = Math.min(Math.max(8, c.left - 8), window.innerWidth - width - 8)
      setPos(window.innerHeight - c.bottom < 280 && c.top > 280 ? { left, bottom: window.innerHeight - c.top + 4 } : { left, top: c.bottom + 4 })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [textarea, at, query])

  if (!pos) return null
  return createPortal(
    <div
      data-popover-open
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: 300 }}
      className="animate-pop-in fixed z-[65] overflow-hidden rounded-lg border border-line bg-surface p-1 text-[12.5px] shadow-pop"
      // Keep the focus (and caret) in the textarea.
      onMouseDown={(e) => e.preventDefault()}
    >
      {options.length ? (
        options.map((p) => (
          <button
            key={p.id}
            type="button"
            onMouseEnter={() => setActive(options.indexOf(p))}
            onClick={() => onPick(p)}
            className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left', p === current && 'bg-surface-2')}
          >
            <Avatar who={p} size={18} />
            <span className="truncate">{p.displayName}</span>
            {p.uniqueName && <span className="ml-auto truncate pl-2 text-[11px] text-faint">{p.uniqueName.split('@')[0]}</span>}
          </button>
        ))
      ) : (
        <div className="px-2 py-1.5 text-faint">{query.trim().length < 3 ? 'Keep typing to search people…' : 'No one found'}</div>
      )}
    </div>,
    document.body
  )
}

function HtmlEditor({
  value,
  onSave,
  onCancel,
  saving,
  placeholder
}: {
  value: string
  onSave(v: string): void
  onCancel(): void
  saving?: boolean
  placeholder?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const initial = useMemo(() => toEditableHtml(value), [value])
  const [empty, setEmpty] = useState(!value.trim())
  const [linkDraft, setLinkDraft] = useState<string | null>(null)
  const savedRange = useRef<Range | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = initial
    el.focus()
    // Caret at the end.
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(r)
  }, [initial])

  // execCommand is deprecated but remains the simplest reliable way to edit contenteditable in Chromium.
  const cmd = (name: string, arg?: string) => {
    ref.current?.focus()
    document.execCommand(name, false, arg)
  }
  const save = () => onSave(fromEditableHtml(ref.current?.innerHTML ?? ''))

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface focus-within:border-accent focus-within:ring-3 focus-within:ring-[var(--ring)]">
      <div className="flex items-center gap-0.5 border-b border-line px-1.5 py-1">
        <ToolBtn title="Heading" onClick={() => cmd('formatBlock', 'h2')} icon={<Heading2 size={14} />} />
        <ToolBtn title="Bold (⌘B)" onClick={() => cmd('bold')} icon={<Bold size={14} />} />
        <ToolBtn title="Italic (⌘I)" onClick={() => cmd('italic')} icon={<Italic size={14} />} />
        <ToolBtn title="Bulleted list" onClick={() => cmd('insertUnorderedList')} icon={<List size={14} />} />
        <ToolBtn title="Numbered list" onClick={() => cmd('insertOrderedList')} icon={<ListOrdered size={14} />} />
        <ToolBtn
          title="Link"
          onClick={() => {
            const sel = window.getSelection()
            savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
            setLinkDraft('https://')
          }}
          icon={<LinkIcon size={14} />}
        />
        <ToolBtn title="Clear formatting" onClick={() => cmd('removeFormat')} icon={<RemoveFormatting size={14} />} />
        {linkDraft !== null && (
          <input
            autoFocus
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onBlur={() => setLinkDraft(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), setLinkDraft(null))
              if (e.key !== 'Enter') return
              e.preventDefault()
              const url = linkDraft.trim()
              setLinkDraft(null)
              if (!/^https?:\/\/\S+$/i.test(url)) return
              ref.current?.focus()
              if (savedRange.current) {
                window.getSelection()?.removeAllRanges()
                window.getSelection()?.addRange(savedRange.current)
              }
              if (window.getSelection()?.isCollapsed) document.execCommand('insertText', false, url)
              const r = window.getSelection()
              if (r?.isCollapsed && r.anchorNode) {
                // Select the URL text that was just inserted so it becomes the link label.
                const range = document.createRange()
                range.setStart(r.anchorNode, Math.max(0, r.anchorOffset - url.length))
                range.setEnd(r.anchorNode, r.anchorOffset)
                r.removeAllRanges()
                r.addRange(range)
              }
              document.execCommand('createLink', false, url)
            }}
            placeholder="https://…  ↵"
            className="ml-1 h-6 min-w-0 flex-1 rounded border border-line bg-surface-2 px-2 text-[12px] outline-none focus:border-accent select-text"
          />
        )}
      </div>
      <div className="relative">
        {empty && <div className="pointer-events-none absolute top-2.5 left-3 text-faint">{placeholder ?? 'Add a description…'}</div>}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => setEmpty(!(e.currentTarget.textContent ?? '').trim() && !e.currentTarget.querySelector('img'))}
          onKeyDown={editorKeys(save, onCancel)}
          className="prose-ado min-h-[140px] px-3 py-2.5 outline-none"
        />
      </div>
      <EditorFooter onSave={save} onCancel={onCancel} saving={saving} hint="Rich text" />
    </div>
  )
}

const TabBtn = ({ active, children, onClick }: { active: boolean; children: ReactNode; onClick(): void }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn('rounded px-2 py-1 text-[12px] font-medium', active ? 'bg-surface-2 text-fg' : 'text-faint hover:text-fg')}
  >
    {children}
  </button>
)

const ToolBtn = ({ title, onClick, icon }: { title: string; onClick(): void; icon: ReactNode }) => (
  <button
    type="button"
    title={title}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    className="rounded p-1 text-faint hover:bg-surface-2 hover:text-fg"
  >
    {icon}
  </button>
)

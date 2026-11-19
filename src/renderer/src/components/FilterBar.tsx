import { useEffect, useMemo, useRef } from 'react'
import { Check, ChevronDown, Search, Tag as TagIcon, UserRound, Users, X } from 'lucide-react'
import type { Meta } from '@/lib/model'
import { isFiltering, useUi } from '@/lib/store'
import type { Identity, WorkItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Avatar, Button, Kbd, Popover, TypeIcon } from './ui'

export function FilterBar({ items, meta }: { items: WorkItem[]; meta?: Meta }) {
  const { filters, setFilters, clearFilters } = useUi()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (e.key === '/' && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const people = useMemo(() => {
    const m = new Map<string, { who: Identity | null; n: number }>()
    for (const w of items) {
      const k = w.assignedTo?.uniqueName ?? '__unassigned'
      const e = m.get(k) ?? { who: w.assignedTo ?? null, n: 0 }
      e.n++
      m.set(k, e)
    }
    return [...m.entries()].sort(([, a], [, b]) => (a.who?.displayName ?? '~').localeCompare(b.who?.displayName ?? '~'))
  }, [items])
  const types = useMemo(() => [...new Set(items.map((w) => w.type))].sort(), [items])
  const tags = useMemo(() => [...new Set(items.flatMap((w) => w.tags))].sort((a, b) => a.localeCompare(b)), [items])

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  return (
    <div className="flex items-center gap-1.5">
      <div className="group relative">
        <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
        <input
          ref={inputRef}
          value={filters.text}
          onChange={(e) => setFilters({ text: e.target.value })}
          onKeyDown={(e) => e.key === 'Escape' && (setFilters({ text: '' }), e.currentTarget.blur())}
          placeholder="Filter by keyword or #id"
          className="h-7 w-56 rounded-md border border-line bg-surface-2 pr-8 pl-7.5 text-[12.5px] outline-none transition-all select-text placeholder:text-faint focus:w-72 focus:border-accent focus:bg-surface"
        />
        <span className="absolute top-1/2 right-2 -translate-y-1/2 group-focus-within:hidden">
          <Kbd>/</Kbd>
        </span>
      </div>

      <Button active={filters.mine} onClick={() => setFilters({ mine: !filters.mine })} title="Only items assigned to me">
        <UserRound size={13} /> Mine
      </Button>

      <FilterMenu
        label="People"
        icon={<Users size={13} />}
        count={filters.assignees.length}
        options={people.map(([k, { who, n }]) => ({
          value: k,
          label: who?.displayName ?? 'Unassigned',
          icon: <Avatar who={who} size={18} />,
          count: n
        }))}
        selected={filters.assignees}
        onToggle={(v) => setFilters({ assignees: toggle(filters.assignees, v) })}
      />
      <FilterMenu
        label="Type"
        count={filters.types.length}
        options={types.map((t) => ({ value: t, label: t, icon: <TypeIcon meta={meta} type={t} /> }))}
        selected={filters.types}
        onToggle={(v) => setFilters({ types: toggle(filters.types, v) })}
      />
      {tags.length > 0 && (
        <FilterMenu
          label="Tags"
          icon={<TagIcon size={13} />}
          count={filters.tags.length}
          options={tags.map((t) => ({ value: t, label: t }))}
          selected={filters.tags}
          onToggle={(v) => setFilters({ tags: toggle(filters.tags, v) })}
        />
      )}
      {isFiltering(filters) && (
        <Button onClick={clearFilters} className="text-faint">
          <X size={13} /> Clear
        </Button>
      )}
    </div>
  )
}

function FilterMenu({
  label,
  icon,
  count,
  options,
  selected,
  onToggle
}: {
  label: string
  icon?: React.ReactNode
  count: number
  options: { value: string; label: string; icon?: React.ReactNode; count?: number }[]
  selected: string[]
  onToggle(v: string): void
}) {
  return (
    <Popover
      trigger={(open, toggle) => (
        <Button onClick={toggle} active={count > 0 || open}>
          {icon}
          {label}
          {count > 0 && <span className="rounded bg-accent px-1 text-[10px] font-semibold text-white">{count}</span>}
          <ChevronDown size={12} className="opacity-60" />
        </Button>
      )}
    >
      {() => (
        <div className="max-h-80 overflow-y-auto p-1">
          {options.length === 0 && <div className="px-2 py-3 text-center text-faint">Nothing to filter</div>}
          {options.map((o) => {
            const on = selected.includes(o.value)
            return (
              <button
                key={o.value}
                onClick={() => onToggle(o.value)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
              >
                <span
                  className={cn(
                    'grid size-3.5 shrink-0 place-items-center rounded border',
                    on ? 'border-accent bg-accent text-white' : 'border-line-strong'
                  )}
                >
                  {on && <Check size={10} strokeWidth={3} />}
                </span>
                {o.icon}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.count !== undefined && <span className="text-[11px] text-faint">{o.count}</span>}
              </button>
            )
          })}
        </div>
      )}
    </Popover>
  )
}

import { memo } from 'react'
import { Clock } from 'lucide-react'
import type { Meta } from '@/lib/model'
import { isDone, typeColor } from '@/lib/model'
import { useUi } from '@/lib/store'
import type { WorkItem } from '@/lib/types'
import { cn, fmtNum } from '@/lib/utils'
import { Avatar, Tag, TypeIcon } from './ui'

export const WorkItemCard = memo(function WorkItemCard({ w, meta }: { w: WorkItem; meta: Meta }) {
  const openItem = useUi((s) => s.openItem)
  const selected = useUi((s) => s.drawerId === w.id)
  const done = isDone(meta, w)
  return (
    <button
      onClick={() => openItem(w.id)}
      className={cn(
        'group relative w-full overflow-hidden rounded-lg border bg-surface p-2.5 pl-3.5 text-left shadow-card transition-all duration-150',
        'hover:-translate-y-px hover:border-line-strong hover:shadow-pop',
        selected ? 'border-accent ring-3 ring-[var(--ring)]' : 'border-line',
        done && 'opacity-60 hover:opacity-100'
      )}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: typeColor(meta, w.type) }} />
      <div className={cn('line-clamp-3 text-[12.5px] leading-snug font-medium', done && 'line-through decoration-faint/60')}>
        {w.title}
      </div>
      {w.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {w.tags.slice(0, 3).map((t) => (
            <Tag key={t} name={t} />
          ))}
          {w.tags.length > 3 && <span className="text-[10.5px] text-faint">+{w.tags.length - 3}</span>}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-faint">
        <TypeIcon meta={meta} type={w.type} size={12} />
        <span className="font-mono tabular-nums">{w.id}</span>
        {w.activity && <span className="truncate">· {w.activity}</span>}
        <span className="flex-1" />
        {w.remaining !== undefined && w.remaining > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded bg-surface-2 px-1 py-px font-medium text-muted tabular-nums">
            <Clock size={10} />
            {fmtNum(w.remaining)}h
          </span>
        )}
        <Avatar who={w.assignedTo} size={20} />
      </div>
    </button>
  )
})

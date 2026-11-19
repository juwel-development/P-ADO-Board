import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Asterisk,
  BookOpen,
  Bug,
  Car,
  ChartBar,
  CircleExclamationPoint,
  ClipboardList,
  Code,
  CodeXml,
  Crown,
  Database,
  Diamond,
  Flame,
  FileText,
  FlaskConical,
  Footprints,
  Gift,
  Key,
  Landmark,
  LightbulbOff,
  ListChecks,
  ListOrdered,
  LoaderCircle,
  Megaphone,
  MessageSquare,
  MessageSquareReply,
  MessagesSquare,
  Paintbrush,
  Palette,
  Plane,
  Rocket,
  Settings,
  SquareCheck,
  Star,
  StickyNote,
  TestTube,
  TrafficCone,
  Trophy,
  Variable,
  type LucideProps
} from 'lucide-react'
import { assetUrl } from '@shared/ipc'
import type { Identity } from '@/lib/types'
import type { Meta } from '@/lib/model'
import { stateInfo, typeColor } from '@/lib/model'
import { cn, hue, initials } from '@/lib/utils'

// ---- work item type icon ----------------------------------------------------

const ICONS: Record<string, ComponentType<LucideProps>> = {
  icon_crown: Crown,
  icon_trophy: Trophy,
  icon_list: ListChecks,
  icon_book: BookOpen,
  icon_clipboard: ClipboardList,
  icon_insect: Bug,
  icon_test_beaker: FlaskConical,
  icon_chart: ChartBar,
  icon_diamond: Diamond,
  icon_gift: Gift,
  icon_star: Star,
  icon_flame: Flame,
  icon_check_box: SquareCheck,
  icon_chat_bubble: MessageSquare,
  icon_traffic_cone: TrafficCone,
  icon_airplane: Plane,
  icon_government: Landmark,
  icon_car: Car,
  icon_key: Key,
  icon_paint_brush: Paintbrush,
  icon_palette: Palette,
  icon_gear: Settings,
  icon_sticky_note: StickyNote,
  icon_megaphone: Megaphone,
  icon_parachute: Rocket,
  icon_database_storage: Database,
  icon_broken_lightbulb: LightbulbOff,
  icon_code_review: CodeXml,
  icon_code_response: Code,
  icon_review: MessagesSquare,
  icon_response: MessageSquareReply,
  icon_test_plan: FileText,
  icon_test_suite: ListOrdered,
  icon_test_case: TestTube,
  icon_test_step: Footprints,
  icon_test_parameter: Variable
}

export function TypeIcon({ meta, type, size = 14 }: { meta?: Meta; type: string; size?: number }) {
  const t = meta?.types.get(type)
  const Icon = (t?.icon && ICONS[t.icon.id]) || Asterisk
  return (
    <Icon
      size={size}
      strokeWidth={2.25}
      style={{ color: meta ? typeColor(meta, type) : undefined }}
      className="shrink-0"
      aria-label={type}
    />
  )
}

// ---- state pill -------------------------------------------------------------

export function StatePill({ meta, type, state, className }: { meta?: Meta; type: string; state: string; className?: string }) {
  const color = meta ? stateInfo(meta, type, state).color : '#8a8f98'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted',
        className
      )}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {state}
    </span>
  )
}

// ---- avatar -----------------------------------------------------------------

export function Avatar({ who, size = 22, className }: { who?: Identity | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  const style = { width: size, height: size, fontSize: Math.max(9, size * 0.4) }
  if (!who) {
    return (
      <span
        style={style}
        title="Unassigned"
        className={cn('inline-grid shrink-0 place-items-center rounded-full border border-dashed border-line-strong text-faint', className)}
      />
    )
  }
  const h = hue(who.uniqueName ?? who.displayName)
  return (
    <span
      title={who.displayName}
      style={{ ...style, background: `hsl(${h} 55% 45%)` }}
      className={cn('relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white', className)}
    >
      {initials(who.displayName)}
      {who.imageUrl && !failed && (
        <img
          src={assetUrl(who.imageUrl)}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
          draggable={false}
        />
      )}
    </span>
  )
}

// ---- small primitives ---------------------------------------------------------

export function Tag({ name }: { name: string }) {
  const h = hue(name)
  return (
    <span
      className="inline-flex max-w-40 items-center truncate rounded px-1.5 py-px text-[10.5px] font-medium"
      style={{ background: `hsl(${h} 70% 50% / 0.13)`, color: `hsl(${h} 45% var(--tag-l, 40%))` }}
    >
      {name}
    </span>
  )
}

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-grid min-w-[18px] place-items-center rounded border border-line bg-surface-2 px-1 font-sans text-[10px] font-medium text-faint">
    {children}
  </kbd>
)

export function Button({
  children,
  variant = 'ghost',
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'ghost' | 'outline' | 'primary'; active?: boolean }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-fg',
        variant === 'outline' && 'border border-line bg-surface text-fg shadow-card hover:bg-surface-2',
        variant === 'primary' && 'bg-accent text-white shadow-card hover:brightness-110',
        active && 'bg-accent-soft text-accent-fg hover:bg-accent-soft hover:text-accent-fg',
        className
      )}
    >
      {children}
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange(v: T): void
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded px-2 text-[12px] font-medium transition-all',
            value === o.value ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const Spinner = ({ size = 14, className }: { size?: number; className?: string }) => (
  <LoaderCircle size={size} className={cn('animate-spin text-faint', className)} />
)

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('skeleton', className)} />

export function ProgressBar({ segments, className }: { segments: { value: number; color: string }[]; className?: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  return (
    <div className={cn('flex h-1.5 overflow-hidden rounded-full bg-surface-3', className)}>
      {segments.map((s, i) => (
        <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} className="transition-all" />
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <div className="text-[14px] font-semibold">{title}</div>
      {children && <div className="max-w-sm text-muted">{children}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState icon={<CircleExclamationPoint size={28} />} title="Couldn’t load from Azure DevOps">
      <p className="mb-3 select-text">{(error as Error)?.message ?? String(error)}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </EmptyState>
  )
}

/**
 * Anchored popover rendered in a portal (so overflow-hidden containers can't clip it), positioned
 * from the trigger, flipped above when there's no room below. Outside click and Escape dismiss it.
 */
export function Popover({
  trigger,
  children,
  align = 'start',
  width = 260,
  className
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end'
  width?: number
  /** Classes for the anchor wrapper. */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return setPos(null)
    const place = () => {
      const r = anchor.current!.getBoundingClientRect()
      const margin = 8
      const below = window.innerHeight - r.bottom - margin
      const above = r.top - margin
      const flip = below < 260 && above > below
      const left = Math.min(Math.max(margin, align === 'end' ? r.right - width : r.left), window.innerWidth - width - margin)
      setPos(flip ? { left, bottom: window.innerHeight - r.top + 6, maxHeight: above - 6 } : { left, top: r.bottom + 6, maxHeight: below - 6 })
    }
    place()
    window.addEventListener('resize', place)
    // Scrolling any container moves the trigger; keep the popover attached.
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, align, width])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!anchor.current?.contains(t) && !pop.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={anchor} className={cn('relative', className)}>
      {trigger(open, () => setOpen((o) => !o))}
      {open &&
        pos &&
        createPortal(
          <div
            ref={pop}
            data-popover-open
            style={{ width, left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: Math.max(160, pos.maxHeight) }}
            className="animate-pop-in fixed z-[65] flex flex-col overflow-hidden rounded-lg border border-line bg-surface text-[12.5px] font-normal tracking-normal normal-case text-fg shadow-pop"
          >
            {children(() => setOpen(false))}
          </div>,
          document.body
        )}
    </div>
  )
}

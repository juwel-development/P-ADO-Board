import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { stateInfo, typeColor } from '@/lib/model'
import { useIdentities, useMeta, useRelatedItems, useTeamMembers } from '@/lib/queries'
import { decorate, mentionedPeople, mentionedWorkItems, toSafeHtml } from '@/lib/richtext'
import { useUi } from '@/lib/store'
import type { Identity } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Renders an ADO rich text value (HTML or markdown). Work item mentions become chips that open
 * in the drawer; images open in a lightbox.
 */
export function RichText({
  value,
  format,
  people = [],
  className
}: {
  value: string
  format?: string
  /** Extra identities to resolve `@<GUID>` mentions (e.g. comment authors). */
  people?: (Identity | undefined)[]
  className?: string
}) {
  const meta = useMeta().data
  const members = useTeamMembers().data
  const openItem = useUi((s) => s.openItem)
  const [zoom, setZoom] = useState<string | null>(null)

  const safe = useMemo(() => toSafeHtml(value, format), [value, format])
  const ids = useMemo(() => mentionedWorkItems(safe), [safe])
  const linked = useRelatedItems(ids, meta)
  const personIds = useMemo(() => mentionedPeople(safe), [safe])
  const known = new Set([...(members ?? []), ...people].map((p) => p?.id?.toLowerCase()))
  const identities = useIdentities(personIds.filter((id) => !known.has(id)))

  const html = useMemo(() => {
    const items = new Map((linked.data ?? []).map((w) => [w.id, w]))
    const names = new Map<string, string>()
    for (const p of [...(identities.data ?? []), ...(members ?? []), ...people]) if (p?.id) names.set(p.id.toLowerCase(), p.displayName)
    return decorate(safe, {
      items,
      people: names,
      typeColor: (t) => (meta ? typeColor(meta, t) : 'var(--faint)'),
      stateColor: (t, s) => (meta ? stateInfo(meta, t, s).color : 'var(--faint)')
    })
  }, [safe, linked.data, identities.data, members, people, meta])

  return (
    <>
      <div
        className={cn('prose-ado', className)}
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={(e) => {
          const el = e.target as HTMLElement
          const wi = el.closest<HTMLElement>('[data-wi]')
          if (wi) {
            e.preventDefault()
            openItem(Number(wi.dataset.wi))
          } else if (el instanceof HTMLImageElement) {
            setZoom(el.src)
          }
        }}
      />
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </>
  )
}

function Lightbox({ src, onClose }: { src: string; onClose(): void }) {
  useEffect(() => {
    // Capture phase so Escape closes only the lightbox, not the drawer underneath.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div
      data-lightbox
      className="animate-fade-in fixed inset-0 z-[60] grid cursor-zoom-out place-items-center bg-black/80 p-10 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Small screenshots are scaled up to a readable size; large ones are fitted to the window. */}
      <img src={src} alt="" className="max-h-full w-[min(1100px,100%)] max-w-full rounded-lg bg-white object-contain shadow-pop" />
      <button className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  )
}

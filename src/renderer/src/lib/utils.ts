import clsx, { type ClassValue } from 'clsx'

export const cn = (...v: ClassValue[]) => clsx(v)

export function initials(name: string): string {
  const clean = name.replace(/\(.*?\)|<.*?>/g, '').trim()
  const parts = clean.includes(',') ? clean.split(',').reverse() : clean.split(/\s+/)
  return parts
    .map((p) => p.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** Stable hue per string, used for avatars and tag chips. */
export function hue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

const dayMs = 86_400_000

export function formatDate(iso?: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  if (!iso) return ''
  // Iteration dates are midnight UTC; render them as calendar dates.
  return new Date(iso).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' })
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const mins = Math.round(diff / 60_000)
  if (Math.abs(mins) < 60) return rtf.format(-mins, 'minute')
  const hours = Math.round(mins / 60)
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return rtf.format(-days, 'day')
  return formatDate(iso, { day: 'numeric', month: 'short', year: 'numeric' })
}

const toUtcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

/** Working days (Mon–Fri) in [from, to], excluding the given day-off ranges. */
export function workingDays(from: Date, to: Date, daysOff: { start: string; end: string }[] = []): number {
  const off = daysOff.map((d) => [toUtcDay(new Date(d.start)), toUtcDay(new Date(d.end))] as const)
  let n = 0
  for (let t = toUtcDay(from); t <= toUtcDay(to); t += dayMs) {
    const wd = new Date(t).getUTCDay()
    if (wd === 0 || wd === 6) continue
    if (off.some(([s, e]) => t >= s && t <= e)) continue
    n++
  }
  return n
}

export const sum = (xs: (number | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0)

export const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export const pluralize = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

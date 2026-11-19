// Person mentions while editing markdown. Azure DevOps stores them as `@<GUID>` (the identity id), which
// is unreadable in a textarea, so the editor shows `@Display Name` and converts back on save.
// Pure (no imports), unit-tested.

export interface MentionPerson {
  id: string
  displayName: string
  uniqueName?: string
}

const GUID_MENTION = /@<([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Display name → mention token, with names claimed by different ids left out (ambiguous). */
export function mentionTokens(people: MentionPerson[]): Map<string, string> {
  const out = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const p of people) {
    const token = `@<${p.id.toUpperCase()}>`
    const prev = out.get(p.displayName)
    if (prev !== undefined && prev.toLowerCase() !== token.toLowerCase()) ambiguous.add(p.displayName)
    else out.set(p.displayName, token)
  }
  for (const name of ambiguous) out.delete(name)
  return out
}

/**
 * `@<GUID>` → `@Display Name` for people we know. Returns the readable text and the tokens it replaced
 * (name → the original `@<GUID>` text), so saving an untouched text reproduces it byte for byte.
 */
export function readableMentions(markdown: string, people: MentionPerson[]): { text: string; tokens: Map<string, string> } {
  const byId = new Map(people.map((p) => [p.id.toLowerCase(), p.displayName]))
  const tokens = new Map<string, string>()
  const clash = new Set<string>()
  const text = markdown.replace(GUID_MENTION, (raw, id: string) => {
    const name = byId.get(id.toLowerCase())
    if (!name || clash.has(name)) return raw
    const prev = tokens.get(name)
    if (prev !== undefined && prev.toLowerCase() !== raw.toLowerCase()) {
      // Two people with the same display name: keep the raw form for the second one.
      clash.add(name)
      return raw
    }
    tokens.set(name, prev ?? raw)
    return `@${name}`
  })
  return { text, tokens }
}

/**
 * `@Display Name` → `@<GUID>`. Only at the start or after whitespace / opening punctuation (so e-mail
 * addresses stay), and not when the name runs on into more letters. Longest names first, so
 * "@Anna Maria Schulz" wins over "@Anna Maria".
 */
export function storableMentions(text: string, tokens: Map<string, string>): string {
  const names = [...tokens.keys()].filter(Boolean).sort((a, b) => b.length - a.length)
  if (!names.length) return text
  const re = new RegExp(`(^|[\\s(\\[{"'>])@(${names.map(escape).join('|')})(?![\\p{L}\\p{N}_])`, 'gu')
  return text.replace(re, (_, lead: string, name: string) => lead + tokens.get(name)!)
}

/** The `@query` being typed at the caret, if any: `start` is the index of the `@`. */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/[\s(\[{"'>]/.test(before[at - 1])) return null
  const query = before.slice(at + 1)
  // Names have spaces ("Müller Anna"), so allow a few words, but stop at line breaks and long runs.
  if (query.length > 40 || /[\n<>@]/.test(query) || /\s{2}/.test(query) || /^\s/.test(query)) return null
  return { start: at, query }
}

/** Lowercase, without diacritics; `ö` also as `oe` so "mueller" finds "Müller". */
function forms(s: string): string[] {
  const lower = s.toLowerCase()
  const plain = lower.normalize('NFD').replace(/\p{M}/gu, '')
  const german = lower.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  return [...new Set([plain, german])]
}

/** People whose name (any word) or account starts with the query, best matches first. */
export function matchPeople<T extends MentionPerson>(people: T[], query: string, limit = 8): T[] {
  const q = forms(query.trim())[0]
  if (!q) return people.slice(0, limit)
  const scored: { p: T; score: number }[] = []
  for (const p of people) {
    let score = -1
    for (const f of forms(p.displayName)) {
      if (f.startsWith(q)) score = Math.max(score, 3)
      else if (f.split(/[\s,.()-]+/).some((w) => w.startsWith(q)) || f.includes(` ${q}`)) score = Math.max(score, 2)
    }
    if (score < 0 && p.uniqueName && forms(p.uniqueName).some((f) => f.split(/[@.\\_-]+/).some((w) => w.startsWith(q)))) score = 1
    if (score >= 0) scored.push({ p, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.p.displayName.localeCompare(b.p.displayName))
    .slice(0, limit)
    .map((x) => x.p)
}

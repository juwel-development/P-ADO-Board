import DOMPurify from 'dompurify'
import { marked } from 'marked'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { assetUrl } from '@shared/ipc'

// ADO rich text comes in two flavours: classic HTML, or markdown that ADO stores HTML-entity-escaped
// (`&quot;`, `-&gt;`). Both end up as sanitized HTML; work item / person mentions are tagged so the
// RichText component can decorate them.

const ENTITIES: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ', '#39': "'" }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

const WI_HREF = /\/_workitems\/edit\/(\d+)/i

function markdownToHtml(md: string): string {
  const src = decodeEntities(md)
    // ADO image sizing syntax `![alt](url =500x)` isn't CommonMark.
    .replace(/(!\[[^\]]*\]\(\S+?)\s+=\d*x\d*\)/g, '$1)')
    // `#1234` mentions (not inside words/URLs) become links we recognise later.
    .replace(/(^|[\s(>])#(\d{3,})\b/g, '$1[#$2](#wi-$2)')
    // `@<GUID>` person mentions.
    .replace(/@<([0-9a-f-]{36})>/gi, '<span data-person="$1">@user</span>')
  return marked.parse(src, { async: false, gfm: true, breaks: true }) as string
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noreferrer')
  }
  // Attachments and inline images need the PAT; the main process proxies them.
  if (node.tagName === 'IMG') {
    const src = node.getAttribute('src') ?? ''
    if (/^https:\/\//i.test(src)) node.setAttribute('src', assetUrl(src))
    node.setAttribute('loading', 'lazy')
  }
  if (node.tagName === 'INPUT') {
    if (node.getAttribute('type') !== 'checkbox') node.remove()
    else node.setAttribute('disabled', '')
  }
})

const sanitize = (html: string) =>
  DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'],
    // Inline colors/fonts from the ADO editor fight both themes; the app styles content itself.
    FORBID_ATTR: ['style', 'class', 'color', 'face', 'size', 'bgcolor', 'width', 'height', 'align']
  })

/** Sanitized HTML for a rich text field. `format` comes from the work item's `multilineFieldsFormat`. */
export function toSafeHtml(value: string, format?: string): string {
  return sanitize(format === 'markdown' ? markdownToHtml(value) : value)
}

const wiIdOf = (a: Element): number | undefined => {
  const href = a.getAttribute('href') ?? ''
  const m = href.match(/^#wi-(\d+)$/) ?? href.match(WI_HREF)
  return m ? Number(m[1]) : undefined
}

/** IDs of work items referenced in already-sanitized HTML. */
export function mentionedWorkItems(html: string): number[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return [...new Set([...doc.querySelectorAll('a[href]')].map(wiIdOf).filter((x): x is number => x !== undefined))]
}

/** GUIDs of people mentioned as `@<GUID>` (markdown) in already-sanitized HTML. */
export function mentionedPeople(html: string): string[] {
  return [...new Set([...html.matchAll(/data-person="([0-9a-f-]{36})"/gi)].map((m) => m[1].toLowerCase()))]
}

export interface MentionContext {
  items: Map<number, { title: string; type: string; state: string }>
  people: Map<string, string>
  typeColor(type: string): string
  stateColor(type: string, state: string): string
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`)

/** Turns work item links into chips (with title + state when known) and resolves person mentions. */
export function decorate(html: string, ctx: MentionContext): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild!

  for (const a of root.querySelectorAll('a[href]')) {
    const id = wiIdOf(a)
    if (id === undefined) continue
    const w = ctx.items.get(id)
    a.setAttribute('data-wi', String(id))
    a.removeAttribute('target')
    a.className = 'wi-chip'
    a.innerHTML = w
      ? `<span class="wi-bar" style="background:${ctx.typeColor(w.type)}"></span><span class="wi-id">${id}</span><span class="wi-title">${escapeHtml(w.title)}</span><span class="wi-state"><span style="background:${ctx.stateColor(w.type, w.state)}"></span>${escapeHtml(w.state)}</span>`
      : `<span class="wi-bar"></span><span class="wi-id">#${id}</span>`
  }

  for (const el of root.querySelectorAll('[data-person], a[data-vss-mention]')) {
    const id = el.getAttribute('data-person')
    if (id === null && wiIdOf(el) !== undefined) continue
    const name = id ? ctx.people.get(id.toLowerCase()) : el.textContent?.replace(/^@/, '')
    const span = doc.createElement('span')
    span.className = 'person-mention'
    span.textContent = `@${name ?? 'someone'}`
    el.replaceWith(span)
  }

  // The ADO HTML editor emits `<div><br></div>` as paragraph spacing; collapse runs of them.
  for (const div of root.querySelectorAll('div')) {
    if (div.childNodes.length === 1 && div.firstChild?.nodeName === 'BR' && div.previousElementSibling?.matches('div.spacer')) div.remove()
    else if (div.childNodes.length === 1 && div.firstChild?.nodeName === 'BR') div.className = 'spacer'
  }
  return root.innerHTML
}

// ---- editing -------------------------------------------------------------------------

/**
 * HTML for the rich editor. Unlike the read view this keeps inline styles and classes, so saving
 * doesn't strip formatting the item already had. Scripts and event handlers are still removed;
 * images are routed through the authenticated proxy so they display.
 */
export function toEditableHtml(html: string): string {
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['form', 'button', 'textarea', 'select'] })
}

/** Inverse of `toEditableHtml`: restores original attachment URLs and drops attributes the viewer added. */
export function fromEditableHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${DOMPurify.sanitize(html, { FORBID_TAGS: ['form', 'button', 'textarea', 'select'] })}</div>`, 'text/html')
  const root = doc.body.firstElementChild!
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? ''
    if (src.startsWith('ado-asset:')) img.setAttribute('src', new URL(src).searchParams.get('u') ?? '')
    img.removeAttribute('loading')
  }
  for (const a of root.querySelectorAll('a[target="_blank"][rel="noreferrer"]')) {
    a.removeAttribute('target')
    a.removeAttribute('rel')
  }
  return root.innerHTML
}

// ---- HTML → Markdown ----------------------------------------------------------------

let turndown: TurndownService | null = null

function converter(): TurndownService {
  if (turndown) return turndown
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '_', hr: '---' })
  td.use(gfm)
  // Turndown escapes defensively (`\[Insert NFR\]`, `snake\_case`); only escape what would really change meaning.
  td.escape = (text: string) =>
    text
      .replace(/\\/g, '\\\\')
      .replace(/\*/g, '\\*')
      .replace(/`/g, '\\`')
      .replace(/(^|[^\w])_(?=\S)|(?<=\S)_(?=[^\w]|$)/g, (m) => m.replace('_', '\\_'))
      .replace(/\](?=\()/g, '\\]')
      .replace(/^(\s*)([-+>]|#{1,6}|\d+\.)(?=\s)/gm, '$1\\$2')
  td.addRule('strikethrough', { filter: ['del', 's', 'strike' as keyof HTMLElementTagNameMap], replacement: (c) => `~~${c}~~` })
  // ADO work item mentions/links → `#123`, which ADO markdown renders as a mention again.
  td.addRule('workItemMention', {
    filter: (node) => node.nodeName === 'A' && (WI_HREF.test(node.getAttribute('href') ?? '') || /^#\d+$/.test(node.textContent?.trim() ?? '')),
    replacement: (content, node) => {
      const id = ((node as HTMLElement).getAttribute('href') ?? '').match(WI_HREF)?.[1] ?? content.replace(/\D/g, '')
      return `#${id}`
    }
  })
  // Person mentions: `<a data-vss-mention="version:2.0,GUID">@Name</a>` → `@<GUID>`.
  td.addRule('personMention', {
    filter: (node) => node.nodeName === 'A' && /[0-9a-f]{8}-[0-9a-f-]{27}/i.test(node.getAttribute('data-vss-mention') ?? ''),
    replacement: (_content, node) => {
      const guid = (node as HTMLElement).getAttribute('data-vss-mention')!.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)![0]
      return `@<${guid}>`
    }
  })
  // The ADO HTML editor uses <div> per line; keep them as separate lines rather than one blob.
  td.addRule('divLines', {
    filter: (node) => node.nodeName === 'DIV' && !node.querySelector('div, p, ul, ol, table, pre, h1, h2, h3, h4, h5, h6'),
    replacement: (content) => (content.trim() ? `\n${content}\n` : '\n')
  })
  turndown = td
  return td
}

/** Converts an ADO HTML field to markdown for editing. Attachment URLs stay the originals. */
export function htmlToMarkdown(html: string): string {
  const clean = fromEditableHtml(html).replace(/&nbsp;|\u00a0/g, ' ')
  let md = converter()
    .turndown(clean)
    // `-   item` → `- item`, `1.  item` → `1. item` (keeps nesting indentation intact).
    .replace(/^(\s*)([-*]|\d+\.)\s{2,}(?=\S)/gm, '$1$2 ')
  // Tight lists: ADO wraps list item text in <div>/<p>, which turndown turns into blank lines.
  for (let i = 0; i < 3; i++) md = md.replace(/^(\s*(?:[-*]|\d+\.) .*)\n\n(?=\s*(?:[-*]|\d+\.) )/gm, '$1\n')
  return md.replace(/\n{3,}/g, '\n\n').trim()
}

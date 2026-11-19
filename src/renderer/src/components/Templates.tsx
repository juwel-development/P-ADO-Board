import { useEffect, useMemo, useState } from 'react'
import { Copy, FileText, FolderOpen, Plus, Trash2, X } from 'lucide-react'
import type { DescriptionTemplate } from '@shared/ipc'
import { useMe, useMeta } from '@/lib/queries'
import { useUi } from '@/lib/store'
import { fillTemplate, sortForType, useRemoveTemplate, useSaveTemplate, useTemplates } from '@/lib/templates'
import { toast } from '@/lib/toasts'
import { cn } from '@/lib/utils'
import { Select, TagEditor, type Option } from './editors'
import { RichText } from './RichText'
import { Button, Kbd } from './ui'

const MANAGE = '__manage'

/** Toolbar menu that fills the description from a local template. */
export function TemplatePicker({ type, title, onApply }: { type?: string; title?: string; onApply(markdown: string): void }) {
  const templates = useTemplates().data ?? []
  const me = useMe().data?.providerDisplayName
  const options: Option[] = [
    ...sortForType(templates, type).map((t) => ({
      value: t.id,
      label: t.name,
      group: type && t.types.includes(type) ? `For ${type}` : t.types.length === 0 ? 'Any type' : 'Other types',
      hint: t.types.length && !(type && t.types.includes(type)) ? t.types.join(', ') : undefined,
      icon: <FileText size={13} className="text-faint" />
    })),
    { value: MANAGE, label: 'Manage templates…', group: ' ', icon: <Plus size={13} className="text-faint" /> }
  ]
  return (
    <Select
      options={options}
      width={300}
      placeholder="Search templates…"
      onChange={(id) => {
        if (id === MANAGE) return useUi.getState().setTemplatesOpen(true)
        const t = templates.find((x) => x.id === id)
        if (t) onApply(fillTemplate(t.body, { title, me }))
      }}
      trigger={(open) => (
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-faint hover:bg-surface-2 hover:text-fg',
            open && 'bg-surface-2 text-fg'
          )}
          title="Fill the description from a template"
        >
          <FileText size={13} /> Template
        </span>
      )}
    />
  )
}

/** Manage local description templates (stored as markdown files on this machine). */
export function TemplatesDialog() {
  const open = useUi((s) => s.templatesOpen)
  const close = () => useUi.getState().setTemplatesOpen(false)
  if (!open) return null
  return (
    <div data-dialog-open className="fixed inset-0 z-[55] grid place-items-center bg-black/30 p-6 backdrop-blur-sm" onMouseDown={close}>
      <div className="animate-pop-in h-[min(720px,90vh)] w-full max-w-[980px]" onMouseDown={(e) => e.stopPropagation()}>
        <Manager onClose={close} />
      </div>
    </div>
  )
}

type Draft = Omit<DescriptionTemplate, 'id'> & { id?: string }

function Manager({ onClose }: { onClose(): void }) {
  const templates = useTemplates()
  const meta = useMeta().data
  const save = useSaveTemplate()
  const remove = useRemoveTemplate()
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [preview, setPreview] = useState(false)

  const list = templates.data ?? []
  const current = list.find((t) => t.id === selected)
  const dirty = !!draft && (!current || draft.name !== current.name || draft.body !== current.body || draft.types.join() !== current.types.join())
  const typeNames = useMemo(() => [...(meta?.types.keys() ?? [])].sort(), [meta])

  useEffect(() => {
    if (!selected && list.length && !draft) setSelected(list[0].id)
  }, [list, selected, draft])
  useEffect(() => {
    if (current) setDraft({ ...current })
  }, [current])

  const select = (id: string | null, next?: Draft) => {
    setSelected(id)
    setDraft(next ?? null)
    setPreview(false)
  }
  const persist = () => {
    if (!draft?.name.trim()) return
    save.mutate(draft, { onSuccess: (t) => select(t.id) })
  }

  return (
    <div
      className="flex h-full overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), persist())
        if (e.key === 'Escape' && !document.querySelector('[data-popover-open]')) (e.stopPropagation(), onClose())
      }}
    >
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-surface-2/40">
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <span className="flex-1 text-[13px] font-semibold">Description templates</span>
          <Button className="h-6 px-1.5" title="New template" onClick={() => select(null, { name: 'New template', types: [], body: '## \n' })}>
            <Plus size={14} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-px overflow-y-auto px-2">
          {list.map((t) => (
            <button
              key={t.id}
              onClick={() => select(t.id)}
              className={cn(
                'block w-full rounded-md px-2.5 py-2 text-left',
                selected === t.id ? 'bg-accent-soft text-accent-fg' : 'hover:bg-surface-2'
              )}
            >
              <div className="truncate text-[12.5px] font-medium">{t.name}</div>
              <div className="truncate text-[11px] text-faint">{t.types.length ? t.types.join(', ') : 'Any type'}</div>
            </button>
          ))}
          {draft && !draft.id && (
            <div className="rounded-md bg-accent-soft px-2.5 py-2 text-[12.5px] font-medium text-accent-fg">{draft.name || 'Untitled'} · new</div>
          )}
        </div>
        <button
          onClick={() => window.ado.templates.openFolder()}
          className="m-2 flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11.5px] text-faint hover:bg-surface-2 hover:text-fg"
          title="Templates are plain .md files — you can also edit them in any editor"
        >
          <FolderOpen size={13} /> Open templates folder
        </button>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <input
            value={draft?.name ?? ''}
            disabled={!draft}
            onChange={(e) => draft && setDraft({ ...draft, name: e.target.value })}
            placeholder="Template name"
            className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold tracking-tight outline-none select-text placeholder:text-faint"
          />
          <button onClick={onClose} className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-fg">
            <X size={16} />
          </button>
        </div>
        {draft ? (
          <>
            <div className="flex items-center gap-2 border-b border-line px-5 py-2 text-[12px]">
              <span className="text-faint">For types</span>
              <TagEditor tags={draft.types} suggestions={typeNames} onChange={(types) => setDraft({ ...draft, types })} />
              {draft.types.length === 0 && <span className="text-faint">· any type</span>}
              <span className="flex-1" />
              <button className={cn('rounded px-2 py-0.5', !preview ? 'bg-surface-2 font-medium' : 'text-faint')} onClick={() => setPreview(false)}>
                Write
              </button>
              <button className={cn('rounded px-2 py-0.5', preview ? 'bg-surface-2 font-medium' : 'text-faint')} onClick={() => setPreview(true)}>
                Preview
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {preview ? (
                <div className="px-5 py-4">
                  <RichText value={fillTemplate(draft.body, { title: 'Example title', me: 'You' })} format="markdown" />
                </div>
              ) : (
                <textarea
                  autoFocus
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  spellCheck={false}
                  className="block h-full min-h-full w-full resize-none bg-transparent px-5 py-4 font-mono text-[12.5px] leading-relaxed outline-none select-text"
                />
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-line bg-surface-2/40 px-5 py-2.5">
              <span className="text-[11px] text-faint">
                Markdown · placeholders <code>{'{{title}}'}</code> <code>{'{{date}}'}</code> <code>{'{{me}}'}</code>
              </span>
              <span className="flex-1" />
              {draft.id && (
                <>
                  <Button
                    title="Duplicate"
                    onClick={() => select(null, { name: `${draft.name} (copy)`, types: draft.types, body: draft.body })}
                  >
                    <Copy size={13} />
                  </Button>
                  <Button
                    title="Delete template"
                    className="hover:text-red-500"
                    onClick={() => {
                      const { name, types, body } = draft
                      remove.mutate(draft.id!, {
                        onSuccess: () => {
                          select(null)
                          toast({ kind: 'success', message: `Deleted template “${name}”`, action: { label: 'Undo', run: () => save.mutate({ name, types, body }) } })
                        }
                      })
                    }}
                  >
                    <Trash2 size={13} />
                  </Button>
                </>
              )}
              <Button variant="primary" className="h-8 px-3" disabled={!dirty || !draft.name.trim() || save.isPending} onClick={persist}>
                {dirty ? 'Save' : 'Saved'} <Kbd>⌘↵</Kbd>
              </Button>
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-faint">Select or create a template</div>
        )}
      </section>
    </div>
  )
}

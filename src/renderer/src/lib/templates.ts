import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DescriptionTemplate } from '@shared/ipc'
import { toast } from './toasts'

const KEY = ['templates']

export function useTemplates() {
  return useQuery({ queryKey: KEY, queryFn: () => window.ado.templates.list(), staleTime: Infinity })
}

export function useSaveTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (t: Omit<DescriptionTemplate, 'id'> & { id?: string }) => window.ado.templates.save(t),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
    onError: (e) => toast({ kind: 'error', message: 'Couldn’t save template', detail: (e as Error).message })
  })
}

export function useRemoveTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => window.ado.templates.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY })
  })
}

export interface TemplateVars {
  title?: string
  me?: string
}

/** Fills `{{title}}`, `{{date}}` and `{{me}}`; unknown placeholders are left as they are. */
export function fillTemplate(body: string, vars: TemplateVars): string {
  const values: Record<string, string | undefined> = {
    title: vars.title,
    me: vars.me,
    date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
  }
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => values[k.toLowerCase()] ?? m)
}

/** Templates for `type` first, then the generic ones, then the rest. */
export function sortForType(templates: DescriptionTemplate[], type?: string) {
  const rank = (t: DescriptionTemplate) => (type && t.types.includes(type) ? 0 : t.types.length === 0 ? 1 : 2)
  return [...templates].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

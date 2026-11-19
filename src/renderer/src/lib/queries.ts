import { useQueries, useQuery } from '@tanstack/react-query'
import * as api from './api'
import { buildMeta, deriveColumns, isTaskLevel, type Meta } from './model'
import { useUi } from './store'
import type { WorkItem } from './types'

const useConn = () => useUi((s) => s.connection)
/** Query key scoped to the current connection. */
export const key = (...parts: unknown[]) => {
  const c = useUi.getState().connection
  return [c?.orgUrl, c?.project, c?.team, ...parts]
}

export function useMeta() {
  const c = useConn()
  return useQuery({
    queryKey: key('meta'),
    enabled: !!c,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<Meta> => {
      const [types, config, fields] = await Promise.all([
        api.getWorkItemTypes(c!),
        api.getBacklogConfig(c!),
        api.getFieldNames(c!)
      ])
      return buildMeta(types, config, fields)
    }
  })
}

export function useMe() {
  const c = useConn()
  return useQuery({ queryKey: key('me'), enabled: !!c, staleTime: Infinity, queryFn: api.getMe })
}

export function useIterations() {
  const c = useConn()
  return useQuery({ queryKey: key('iterations'), enabled: !!c, staleTime: 10 * 60_000, queryFn: () => api.getIterations(c!) })
}

/** Loads parents that are not part of the fetched set, so cards can be shown in context. */
async function withMissingParents(meta: Meta, items: WorkItem[], filterFn: (w: WorkItem) => boolean) {
  const c = useUi.getState().connection!
  const have = new Set(items.map((w) => w.id))
  const missing = [...new Set(items.filter(filterFn).map((w) => w.parentId))].filter(
    (id): id is number => id !== undefined && !have.has(id)
  )
  return api.getWorkItems(c, missing, meta.fieldMap, meta.fields)
}

export function useSprint(iterationId: string | null, meta: Meta | undefined) {
  const c = useConn()
  return useQuery({
    queryKey: key('sprint', iterationId),
    enabled: !!c && !!iterationId && !!meta,
    refetchInterval: 2 * 60_000,
    queryFn: async () => {
      const [ids, cols, placed] = await Promise.all([
        api.getIterationWorkItemIds(c!, iterationId!),
        api.getTaskboardColumns(c!).catch(() => null),
        api.getTaskboardItemColumns(c!, iterationId!).catch(() => [])
      ])
      const items = await api.getWorkItems(c!, ids, meta!.fieldMap, meta!.fields)
      const outsideParents = await withMissingParents(meta!, items, (w) => isTaskLevel(meta!, w))
      const columns = cols?.columns?.length
        ? [...cols.columns].sort((a, b) => a.order - b.order)
        : deriveColumns(meta!, items)
      return { items, outsideParents, columns, placed: new Map(placed.map((p) => [p.workItemId, p])) }
    }
  })
}

export function useBacklog(levelId: string | null, meta: Meta | undefined, withParents: boolean) {
  const c = useConn()
  return useQuery({
    queryKey: key('backlog', levelId, withParents),
    enabled: !!c && !!levelId && !!meta,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const ids = await api.getBacklogLevelIds(c!, levelId!)
      const items = await api.getWorkItems(c!, ids, meta!.fieldMap, meta!.fields)
      // Resolve the full ancestor chain (e.g. Feature → Epic) for the tree view.
      const ancestors: WorkItem[] = []
      if (withParents) {
        let frontier = items
        for (let depth = 0; depth < 4 && frontier.length; depth++) {
          frontier = await withMissingParents(meta!, [...items, ...ancestors, ...frontier], () => true)
          ancestors.push(...frontier)
        }
      }
      return { ids, items, ancestors }
    }
  })
}

export function useChildren(id: number, enabled: boolean, meta: Meta | undefined) {
  const c = useConn()
  return useQuery({
    queryKey: key('children', id),
    enabled: !!c && enabled && !!meta,
    queryFn: async () => {
      const detail = await api.getWorkItemDetail(c!, id)
      const childIds = (detail.relations ?? [])
        .filter((r) => r.rel === 'System.LinkTypes.Hierarchy-Forward')
        .map((r) => Number(r.url.split('/').pop()))
      const items = await api.getWorkItems(c!, childIds, meta!.fieldMap, meta!.fields)
      // Backlog order (Stack Rank / Backlog Priority), not the order the links were created in.
      return items.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
    }
  })
}

export function useWorkItem(id: number | null) {
  const c = useConn()
  return useQuery({ queryKey: key('item', id), enabled: !!c && id !== null, queryFn: () => api.getWorkItemDetail(c!, id!) })
}

export function useRelatedItems(ids: number[], meta: Meta | undefined) {
  const c = useConn()
  return useQuery({
    queryKey: key('related', ids),
    enabled: !!c && !!meta && ids.length > 0,
    queryFn: () => api.getWorkItems(c!, ids, meta!.fieldMap, meta!.fields)
  })
}

export function useComments(id: number | null) {
  const c = useConn()
  return useQuery({ queryKey: key('comments', id), enabled: !!c && id !== null, queryFn: () => api.getComments(c!, id!) })
}

export function useTeamMembers() {
  const c = useConn()
  return useQuery({ queryKey: key('members'), enabled: !!c, staleTime: 60 * 60_000, queryFn: () => api.getTeamMembers(c!) })
}

export function useIdentities(ids: string[]) {
  const c = useConn()
  return useQuery({
    queryKey: key('identities', [...ids].sort()),
    enabled: !!c && ids.length > 0,
    staleTime: Infinity,
    retry: false,
    queryFn: () => api.getIdentities(ids).catch(() => [])
  })
}

/** People search for @mentions; empty when the PAT lacks Identity (Read). */
export function useIdentitySearch(text: string) {
  const c = useConn()
  const q = text.trim().toLowerCase()
  return useQuery({
    queryKey: key('identitySearch', q),
    enabled: !!c && q.length >= 3,
    staleTime: 30 * 60_000,
    retry: false,
    placeholderData: (prev) => prev,
    queryFn: () => api.searchIdentities(q).catch(() => [])
  })
}

/** Active pull requests of a followed repository (the subscription check keeps this fresh too). */
const pullRequestsQuery = (enabled: boolean, project: string | undefined, repoId: string | undefined) => ({
  queryKey: key('pulls', repoId),
  enabled: enabled && !!project && !!repoId,
  staleTime: 60_000,
  refetchInterval: 5 * 60_000,
  retry: false,
  queryFn: () => api.getActivePullRequests(project!, repoId!)
})

export function usePullRequests(project: string | undefined, repoId: string | undefined) {
  const c = useConn()
  return useQuery(pullRequestsQuery(!!c, project, repoId))
}

/** Active pull requests of several repositories, in the same order (shares the cache with `usePullRequests`). */
export function usePullRequestsOf(repos: { project: string; id: string }[]) {
  const c = useConn()
  return useQueries({ queries: repos.map((r) => pullRequestsQuery(!!c, r.project, r.id)) })
}

/** Repositories to pick from when following one; needs the PAT scope Code (Read). */
export function useRepositories(enabled: boolean) {
  const c = useConn()
  return useQuery({ queryKey: key('repos'), enabled: !!c && enabled, staleTime: 30 * 60_000, retry: false, queryFn: () => api.getRepositories(c!) })
}

export function useTeamDefaults() {
  const c = useConn()
  return useQuery({ queryKey: key('teamDefaults'), enabled: !!c, staleTime: 30 * 60_000, queryFn: () => api.getTeamDefaults(c!) })
}

export function useAllowedValues(type: string | undefined, field: string | undefined) {
  const c = useConn()
  return useQuery({
    queryKey: key('allowed', type, field),
    enabled: !!c && !!type && !!field,
    staleTime: 60 * 60_000,
    queryFn: () => api.getAllowedValues(c!, type!, field!).catch(() => [])
  })
}

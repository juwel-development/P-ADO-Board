import type { AdoRequest, Connection } from '@shared/ipc'
import type { WorkItemUpdate } from './changes'
import type {
  BacklogConfiguration,
  Comment,
  Identity,
  Iteration,
  TaskboardColumn,
  TaskboardWorkItemColumn,
  WorkItem,
  WorkItemDetail,
  WorkItemType
} from './types'

export class AdoError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export async function ado<T>(req: AdoRequest): Promise<T> {
  return (await adoWrite<T>(req)).data
}

/** Like `ado`, but also reports whether the main process only validated the write. */
export async function adoWrite<T>(req: AdoRequest): Promise<{ data: T; dryRun: boolean }> {
  const res = await window.ado.ado<T>(req)
  if (!res.ok) throw new AdoError(res.message, res.status)
  return { data: res.data, dryRun: !!res.dryRun }
}

const enc = encodeURIComponent
const projectPath = (c: Connection) => `/${enc(c.project)}`
const teamPath = (c: Connection) => `/${enc(c.project)}/${enc(c.team)}`

type List<T> = { value: T[]; count: number }

// ---- onboarding -----------------------------------------------------------

export const probeProjects = (orgUrl: string, pat?: string) =>
  ado<List<{ id: string; name: string; description?: string }>>({
    path: '/_apis/projects',
    query: { $top: 500 },
    probe: { orgUrl, pat }
  }).then((r) => r.value.sort((a, b) => a.name.localeCompare(b.name)))

export const probeTeams = (orgUrl: string, project: string, pat?: string) =>
  ado<List<{ id: string; name: string }>>({
    path: `/_apis/projects/${enc(project)}/teams`,
    query: { $top: 500 },
    probe: { orgUrl, pat }
  }).then((r) => r.value.sort((a, b) => a.name.localeCompare(b.name)))

// ---- project / team metadata -----------------------------------------------

export const getMe = () =>
  ado<{ authenticatedUser: { id: string; providerDisplayName: string } }>({
    path: '/_apis/connectionData',
    query: { 'api-version': '7.1-preview' }
  }).then((r) => r.authenticatedUser)

export const getWorkItemTypes = (c: Connection) =>
  ado<List<WorkItemType>>({ path: `${projectPath(c)}/_apis/wit/workitemtypes` }).then((r) => r.value)

export const getFieldNames = (c: Connection) =>
  ado<List<{ referenceName: string }>>({ path: `${projectPath(c)}/_apis/wit/fields` }).then(
    (r) => new Set(r.value.map((f) => f.referenceName))
  )

export const getBacklogConfig = (c: Connection) =>
  ado<BacklogConfiguration>({ path: `${teamPath(c)}/_apis/work/backlogconfiguration` })

export const getIterations = (c: Connection) =>
  ado<List<Iteration>>({ path: `${teamPath(c)}/_apis/work/teamsettings/iterations` }).then((r) => r.value)

export const getTaskboardColumns = (c: Connection) =>
  ado<{ columns: TaskboardColumn[]; isCustomized: boolean }>({ path: `${teamPath(c)}/_apis/work/taskboardcolumns` })

export const getTaskboardItemColumns = (c: Connection, iterationId: string) =>
  ado<List<TaskboardWorkItemColumn>>({ path: `${teamPath(c)}/_apis/work/taskboardworkitems/${iterationId}` }).then(
    (r) => r.value
  )

export const getTeamMembers = (c: Connection) =>
  ado<List<{ identity: Identity }>>({
    path: `/_apis/projects/${enc(c.project)}/teams/${enc(c.team)}/members`,
    query: { $top: 500 }
  }).then((r) => r.value.map((m) => m.identity))

/** Needs the PAT scope Identity (Read); callers treat failure as "unknown". */
export const getIdentities = (ids: string[]) =>
  ado<List<{ id: string; providerDisplayName: string } | null>>({
    path: '/_apis/identities',
    service: 'vssps',
    query: { identityIds: ids.join(',') }
  }).then((r) => r.value.filter((x) => x !== null).map((x) => ({ id: x!.id, displayName: x!.providerDisplayName })))

/** People in the organization by name or account (prefix). Needs Identity (Read), like `getIdentities`. */
export const searchIdentities = (text: string) =>
  ado<
    List<{
      id: string
      providerDisplayName: string
      isContainer?: boolean
      isActive?: boolean
      properties?: Record<string, { $value?: string } | undefined>
    }>
  >({
    path: '/_apis/identities',
    service: 'vssps',
    query: { searchFilter: 'General', filterValue: text, queryMembership: 'None' }
  }).then((r) =>
    r.value
      .filter((x) => !x.isContainer && x.isActive !== false)
      .map((x): Identity => ({
        id: x.id,
        displayName: x.providerDisplayName,
        uniqueName: x.properties?.Account?.$value ?? x.properties?.Mail?.$value
      }))
  )

// ---- work items -------------------------------------------------------------

export const getIterationWorkItemIds = (c: Connection, iterationId: string) =>
  ado<{ workItemRelations: { target: { id: number } }[] }>({
    path: `${teamPath(c)}/_apis/work/teamsettings/iterations/${iterationId}/workitems`
  }).then((r) => [...new Set(r.workItemRelations.map((x) => x.target.id))])

export const getBacklogLevelIds = (c: Connection, backlogId: string) =>
  ado<{ workItems: { target: { id: number } }[] }>({
    path: `${teamPath(c)}/_apis/work/backlogs/${enc(backlogId)}/workItems`
  }).then((r) => r.workItems.map((x) => x.target.id))

export interface FieldMap {
  order?: string
  effort?: string
  remaining?: string
  activity?: string
}

const BASE_FIELDS = [
  'System.Id',
  'System.WorkItemType',
  'System.Title',
  'System.State',
  'System.AssignedTo',
  'System.Tags',
  'System.Parent',
  'System.IterationPath',
  'System.AreaPath',
  'System.ChangedDate',
  'System.CreatedDate',
  'Microsoft.VSTS.Common.Priority',
  'Microsoft.VSTS.Scheduling.CompletedWork'
]

const num = (v: unknown) => (typeof v === 'number' ? v : undefined)

export interface RawWorkItem {
  id: number
  rev: number
  fields: Record<string, unknown>
}

export function normalize(raw: RawWorkItem, fm: FieldMap): WorkItem {
  const f = raw.fields
  const tags = typeof f['System.Tags'] === 'string' ? (f['System.Tags'] as string) : ''
  return {
    id: raw.id,
    rev: raw.rev,
    type: f['System.WorkItemType'] as string,
    title: f['System.Title'] as string,
    state: f['System.State'] as string,
    assignedTo: f['System.AssignedTo'] as Identity | undefined,
    tags: tags ? tags.split(';').map((t) => t.trim()).filter(Boolean) : [],
    parentId: num(f['System.Parent']),
    iterationPath: f['System.IterationPath'] as string,
    areaPath: f['System.AreaPath'] as string,
    priority: num(f['Microsoft.VSTS.Common.Priority']),
    completed: num(f['Microsoft.VSTS.Scheduling.CompletedWork']),
    order: fm.order ? num(f[fm.order]) : undefined,
    effort: fm.effort ? num(f[fm.effort]) : undefined,
    remaining: fm.remaining ? num(f[fm.remaining]) : undefined,
    activity: fm.activity ? (f[fm.activity] as string | undefined) : undefined,
    changedDate: f['System.ChangedDate'] as string,
    createdDate: f['System.CreatedDate'] as string
  }
}

/** Batch-fetches work items (200 per request); fields not present in the project are dropped. */
export async function getWorkItems(
  c: Connection,
  ids: number[],
  fm: FieldMap,
  known: Set<string>
): Promise<WorkItem[]> {
  if (ids.length === 0) return []
  const fields = [...BASE_FIELDS, ...Object.values(fm)].filter((f): f is string => !!f && known.has(f))
  const chunks: number[][] = []
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200))
  const results = await Promise.all(
    chunks.map((chunk) =>
      ado<List<{ id: number; rev: number; fields: Record<string, unknown> } | null>>({
        path: `${projectPath(c)}/_apis/wit/workitemsbatch`,
        method: 'POST',
        body: { ids: chunk, fields: [...new Set(fields)], errorPolicy: 'omit' }
      })
    )
  )
  return results.flatMap((r) => r.value.filter((x) => x !== null).map((x) => normalize(x, fm)))
}

export const getWorkItemDetail = (c: Connection, id: number) =>
  ado<WorkItemDetail>({ path: `${projectPath(c)}/_apis/wit/workitems/${id}`, query: { $expand: 'all' } })

export const getComments = (c: Connection, id: number) =>
  ado<{ comments: Comment[] }>({
    path: `${projectPath(c)}/_apis/wit/workItems/${id}/comments`,
    query: { 'api-version': '7.1-preview.4', order: 'desc' }
  }).then((r) => r.comments)

// ---- subscriptions -----------------------------------------------------------------

const wiqlString = (s: string) => `'${s.replace(/'/g, "''")}'`

/** Ids of items the signed-in user created in this project that aren't in one of `doneStates`. */
export async function getOpenItemsCreatedByMe(c: Connection, doneStates: string[]): Promise<number[]> {
  const notDone = doneStates.length ? ` AND [System.State] NOT IN (${doneStates.map(wiqlString).join(', ')})` : ''
  const res = await ado<{ workItems: { id: number }[] }>({
    path: `${projectPath(c)}/_apis/wit/wiql`,
    method: 'POST',
    query: { $top: 1000 },
    body: {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.CreatedBy] = @me${notDone} ORDER BY [System.ChangedDate] DESC`
    }
  })
  return res.workItems.map((w) => w.id)
}

/** Ids of items in this project where someone @mentioned the signed-in user in the last 30 days. */
export const getRecentMentionIds = (c: Connection) =>
  ado<{ workItems: { id: number }[] }>({
    path: `${projectPath(c)}/_apis/wit/wiql`,
    method: 'POST',
    query: { $top: 1000 },
    body: {
      query: 'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Id] IN (@RecentMentions) ORDER BY [System.ChangedDate] DESC'
    }
  }).then((r) => r.workItems.map((w) => w.id))

export interface Revision {
  id: number
  rev: number
  title: string
  type: string
  state: string
  changedDate: string
}

/** Current revision of each item (200 per request); deleted or inaccessible items are left out. */
export async function getRevisions(c: Connection, ids: number[]): Promise<Revision[]> {
  const chunks: number[][] = []
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200))
  const results = await Promise.all(
    chunks.map((chunk) =>
      ado<List<RawWorkItem | null>>({
        path: `${projectPath(c)}/_apis/wit/workitemsbatch`,
        method: 'POST',
        body: { ids: chunk, fields: ['System.Title', 'System.WorkItemType', 'System.State', 'System.ChangedDate'], errorPolicy: 'omit' }
      })
    )
  )
  return results.flatMap((r) =>
    r.value
      .filter((x) => x !== null)
      .map((x) => ({
        id: x!.id,
        rev: x!.rev,
        title: x!.fields['System.Title'] as string,
        type: x!.fields['System.WorkItemType'] as string,
        state: x!.fields['System.State'] as string,
        changedDate: x!.fields['System.ChangedDate'] as string
      }))
  )
}

/** Revisions after `sinceRev` (update n describes revision n, so the first `sinceRev - 1` are skipped). */
export const getUpdatesSince = (c: Connection, id: number, sinceRev: number) =>
  ado<List<WorkItemUpdate>>({
    path: `${projectPath(c)}/_apis/wit/workItems/${id}/updates`,
    query: { $skip: Math.max(0, sinceRev - 1), $top: 200 }
  }).then((r) => r.value.filter((u) => u.rev > sinceRev))

// ---- pull requests (needs the PAT scope Code (Read)) ---------------------------------

export interface GitRepository {
  id: string
  name: string
  isDisabled?: boolean
  project: { id: string; name: string }
}

export interface PullRequest {
  pullRequestId: number
  title: string
  status: 'active' | 'completed' | 'abandoned'
  isDraft?: boolean
  creationDate: string
  createdBy: Identity
  mergeStatus?: 'notSet' | 'queued' | 'conflicts' | 'succeeded' | 'rejectedByPolicy' | 'failure'
  sourceRefName: string
  targetRefName: string
  reviewers?: (Identity & { vote?: number; isRequired?: boolean })[]
  repository: { id: string; name: string; project: { name: string } }
}

/** All repositories of the organization (falls back to the board's project). */
export const getRepositories = (c: Connection) =>
  ado<List<GitRepository>>({ path: '/_apis/git/repositories' })
    .catch(() => ado<List<GitRepository>>({ path: `${projectPath(c)}/_apis/git/repositories` }))
    .then((r) => r.value.filter((x) => !x.isDisabled).sort((a, b) => a.project.name.localeCompare(b.project.name) || a.name.localeCompare(b.name)))

export const getActivePullRequests = (project: string, repoId: string) =>
  ado<List<PullRequest>>({
    path: `/${enc(project)}/_apis/git/repositories/${enc(repoId)}/pullrequests`,
    query: { 'searchCriteria.status': 'active', $top: 200 }
  }).then((r) => r.value)

/** Active pull requests in `project` that have the user as a reviewer. */
export const getPullRequestsToReview = (project: string, reviewerId: string) =>
  ado<List<PullRequest>>({
    path: `/${enc(project)}/_apis/git/pullrequests`,
    query: { 'searchCriteria.reviewerId': reviewerId, 'searchCriteria.status': 'active', $top: 200 }
  }).then((r) => r.value)

export const repoPullsWebUrl = (c: Connection, project: string, repo: string) =>
  `${c.orgUrl.replace(/\/+$/, '')}/${enc(project)}/_git/${enc(repo)}/pullrequests?_a=active`

export const pullRequestWebUrl = (c: Connection, project: string, repo: string, id: number) =>
  `${c.orgUrl.replace(/\/+$/, '')}/${enc(project)}/_git/${enc(repo)}/pullrequest/${id}`

export const workItemWebUrl = (c: Connection, id: number) =>
  `${c.orgUrl.replace(/\/+$/, '')}/${enc(c.project)}/_workitems/edit/${id}`

export const sprintWebUrl = (c: Connection, iteration: Iteration) =>
  `${c.orgUrl.replace(/\/+$/, '')}/${enc(c.project)}/_sprints/taskboard/${enc(c.team)}/${iteration.path
    .split('\\')
    .map(enc)
    .join('/')}`

// ---- team defaults -----------------------------------------------------------

export interface TeamDefaults {
  /** Iteration new backlog items land in (often the project root). */
  backlogIterationPath: string
  areaPath?: string
}

export async function getTeamDefaults(c: Connection): Promise<TeamDefaults> {
  const [settings, fieldValues] = await Promise.all([
    ado<{ backlogIteration?: { name: string; path?: string } }>({ path: `${teamPath(c)}/_apis/work/teamsettings` }),
    ado<{ defaultValue?: string; field?: { referenceName: string } }>({
      path: `${teamPath(c)}/_apis/work/teamsettings/teamfieldvalues`
    }).catch(() => null)
  ])
  const bi = settings.backlogIteration
  return {
    backlogIterationPath: bi?.path || bi?.name || c.project,
    areaPath: fieldValues?.field?.referenceName === 'System.AreaPath' ? fieldValues.defaultValue : undefined
  }
}

export const getAllowedValues = (c: Connection, type: string, field: string) =>
  ado<{ allowedValues?: string[] }>({
    path: `${projectPath(c)}/_apis/wit/workitemtypes/${enc(type)}/fields/${enc(field)}`,
    query: { $expand: 'allowedValues' }
  }).then((r) => r.allowedValues ?? [])

// ---- writes (the main process allows exactly these) ----------------------------

export type PatchOp = { op: 'add' | 'replace' | 'remove' | 'test'; path: string; value?: unknown }

export const updateWorkItem = (c: Connection, id: number, ops: PatchOp[]) =>
  adoWrite<RawWorkItem>({ path: `${projectPath(c)}/_apis/wit/workitems/${id}`, method: 'PATCH', body: ops })

export const createWorkItem = (c: Connection, type: string, ops: PatchOp[]) =>
  adoWrite<RawWorkItem>({ path: `${projectPath(c)}/_apis/wit/workitems/$${enc(type)}`, method: 'POST', body: ops })

export const addComment = (c: Connection, id: number, markdown: string) =>
  adoWrite<Comment>({
    path: `${projectPath(c)}/_apis/wit/workItems/${id}/comments`,
    method: 'POST',
    query: { 'api-version': '7.1-preview.4', format: 'markdown' },
    body: { text: markdown }
  })

/**
 * Reorders the team backlog: places `ids` between `previousId` and `nextId` (0 = none). ADO computes the
 * new order values (StackRank/BacklogPriority) and returns them.
 */
export async function reorderBacklog(c: Connection, op: { ids: number[]; previousId: number; nextId: number; parentId?: number }) {
  const res = await adoWrite<{ value?: { id: number; order: number }[] } | { id: number; order: number }[]>({
    path: `${teamPath(c)}/_apis/work/workitemsorder`,
    method: 'PATCH',
    body: { ids: op.ids, previousId: op.previousId, nextId: op.nextId, ...(op.parentId !== undefined ? { parentId: op.parentId } : {}) }
  })
  const value = Array.isArray(res.data) ? res.data : (res.data.value ?? [])
  return { data: value, dryRun: res.dryRun }
}

export const workItemApiUrl = (c: Connection, id: number) => `${c.orgUrl.replace(/\/+$/, '')}/_apis/wit/workItems/${id}`

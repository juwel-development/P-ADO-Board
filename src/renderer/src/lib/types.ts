// Subset of the Azure DevOps REST shapes the app relies on (api-version 7.1).

export type StateCategory = 'Proposed' | 'InProgress' | 'Resolved' | 'Completed' | 'Removed'

export interface Identity {
  id?: string
  displayName: string
  uniqueName?: string
  imageUrl?: string
}

export interface WorkItemTypeState {
  name: string
  color: string
  category: StateCategory
}

export interface WorkItemType {
  name: string
  color: string
  icon?: { id: string }
  states: WorkItemTypeState[]
  /** Fields this type has; used to decide which properties are editable/creatable. */
  fields?: { referenceName: string; name: string; alwaysRequired?: boolean; defaultValue?: unknown }[]
}

export interface BacklogLevel {
  id: string
  name: string
  rank: number
  color: string
  workItemTypes: { name: string }[]
  defaultWorkItemType?: { name: string }
}

export interface BacklogConfiguration {
  portfolioBacklogs: BacklogLevel[]
  requirementBacklog: BacklogLevel
  taskBacklog: BacklogLevel
  bugsBehavior: 'off' | 'asRequirements' | 'asTasks'
  backlogFields: { typeFields: Record<string, string> }
}

export interface Iteration {
  id: string
  name: string
  path: string
  attributes: { startDate?: string; finishDate?: string; timeFrame?: 'past' | 'current' | 'future' }
}

export interface TaskboardColumn {
  id: string
  name: string
  order: number
  mappings: { workItemType: string; state: string }[]
}

export interface TaskboardWorkItemColumn {
  workItemId: number
  column: string
  columnId: string
  state: string
}


/** Normalized work item used throughout the UI. */
export interface WorkItem {
  id: number
  rev: number
  type: string
  title: string
  state: string
  assignedTo?: Identity
  tags: string[]
  parentId?: number
  iterationPath: string
  areaPath: string
  priority?: number
  order?: number
  effort?: number
  remaining?: number
  completed?: number
  activity?: string
  changedDate: string
  createdDate: string
}

export interface Comment {
  id: number
  text: string
  /** Server-rendered HTML for markdown comments; ADO sometimes returns an empty string. */
  renderedText?: string
  format?: string
  createdBy: Identity
  createdDate: string
}

export interface Relation {
  rel: string
  url: string
  attributes?: { name?: string }
}

export interface WorkItemDetail {
  id: number
  rev: number
  fields: Record<string, unknown>
  relations?: Relation[]
  /** Fields stored as markdown instead of HTML, e.g. { 'System.Description': 'markdown' }. */
  multilineFieldsFormat?: Record<string, string>
  _links?: { html?: { href: string } }
}

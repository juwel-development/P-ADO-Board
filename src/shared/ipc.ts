// Contract between the Electron main process and the renderer.
// The PAT never crosses this boundary towards the renderer.

export interface Connection {
  /** e.g. https://dev.azure.com/your-org */
  orgUrl: string
  project: string
  team: string
}

/** `off`: read-only · `validate`: ADO validates changes but saves nothing · `live`: changes are saved. */
export type WriteMode = 'off' | 'validate' | 'live'

export interface SettingsState {
  connection: Connection | null
  hasPat: boolean
  writeMode: WriteMode
}

export interface SaveSettingsInput {
  connection: Connection
  /** Omit to keep the stored PAT. */
  pat?: string
}

export interface AdoRequest {
  /** Path relative to the organization URL, e.g. `/MyProject/_apis/wit/workitemtypes`. */
  path: string
  query?: Record<string, string | number | boolean | undefined>
  /** The main process only lets through reads plus work item update/create and adding comments. */
  method?: 'GET' | 'POST' | 'PATCH'
  /** Route to an org-level service host instead of the org URL (e.g. identities live on vssps). */
  service?: 'vssps'
  body?: unknown
  /** Override org/PAT, used by the onboarding flow before settings are saved. */
  probe?: { orgUrl: string; pat?: string }
}

export type AdoResult<T = unknown> =
  | { ok: true; data: T; /** true when the write was only validated (ADO_BOARD_WRITES=validate). */ dryRun?: boolean }
  | { ok: false; status: number; message: string }

/** A local description template (a markdown file in the app's data folder). */
export interface DescriptionTemplate {
  /** File name, e.g. `user-story.md`. */
  id: string
  name: string
  /** Work item types the template is meant for; empty = any type. */
  types: string[]
  body: string
}

export interface TemplatesApi {
  list(): Promise<DescriptionTemplate[]>
  /** Creates (no id) or updates a template; returns the stored version. */
  save(t: Omit<DescriptionTemplate, 'id'> & { id?: string }): Promise<DescriptionTemplate>
  remove(id: string): Promise<void>
  /** Reveals the templates folder in Finder/Explorer. */
  openFolder(): Promise<void>
}

/** Local store for subscription state, one JSON document per org + project. */
export interface WatchApi {
  load(scope: string): Promise<unknown | null>
  save(scope: string, data: unknown): Promise<void>
}

export interface SystemNotification {
  title: string
  body: string
  /** Handed back to `onNotificationClick` when the user clicks the notification. */
  tag: string
}

/** Outcome of a test notification; macOS asks for permission the first time one is posted. */
export interface NotificationTest {
  status: 'shown' | 'failed' | 'unsupported' | 'timeout'
  error?: string
}

export interface BridgeApi {
  getSettings(): Promise<SettingsState>
  saveSettings(input: SaveSettingsInput): Promise<SettingsState>
  clearPat(): Promise<SettingsState>
  ado<T = unknown>(req: AdoRequest): Promise<AdoResult<T>>
  openExternal(url: string): Promise<void>
  templates: TemplatesApi
  watch: WatchApi
  /** Shows an OS notification. */
  notify(n: SystemNotification): Promise<void>
  /** Posts a test notification — on first use this is what triggers the OS permission dialog. */
  testNotification(): Promise<NotificationTest>
  /** Opens the OS notification settings (macOS System Settings → Notifications). */
  openNotificationSettings(): Promise<void>
  /** Subscribes to notification clicks; returns an unsubscribe function. */
  onNotificationClick(cb: (tag: string) => void): () => void
  /** Number on the dock icon (0 clears it). */
  setBadge(count: number): Promise<void>
  platform: NodeJS.Platform
}

/** Builds a URL for authenticated ADO images (avatars, attachments) served by the main process. */
export const assetUrl = (url: string): string => `ado-asset://img/?u=${encodeURIComponent(url)}`

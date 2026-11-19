import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Connection, WriteMode } from '@shared/ipc'

export type View = 'board' | 'backlog' | 'inbox' | 'repo'
export type GroupBy = 'parent' | 'person' | 'none'
export type ThemePref = 'system' | 'light' | 'dark'

export interface Filters {
  text: string
  mine: boolean
  assignees: string[]
  types: string[]
  tags: string[]
}

export const emptyFilters: Filters = { text: '', mine: false, assignees: [], types: [], tags: [] }

/** Desktop notifications: `unset` until the user answers the first-run prompt. */
export type NotificationPref = 'unset' | 'on' | 'off'

export interface CreateRequest {
  type?: string
  parentId?: number
  iterationPath?: string
}

interface UiState {
  connection: Connection | null
  writeMode: WriteMode
  create: CreateRequest | null
  templatesOpen: boolean
  view: View
  iterationId: string | null
  drawerId: number | null
  /** Followed repository shown in the `repo` view. */
  repoId: string | null
  paletteOpen: boolean
  settingsOpen: boolean
  filters: Filters
  groupBy: GroupBy
  collapsed: Record<string, boolean>
  theme: ThemePref
  sidebarCollapsed: boolean
  backlogLevelId: string | null
  backlogShowParents: boolean
  backlogShowCompleted: boolean
  notifications: NotificationPref

  setConnection(c: Connection | null): void
  setWriteMode(m: WriteMode): void
  openCreate(r: CreateRequest | null): void
  setTemplatesOpen(open: boolean): void
  setView(v: View): void
  setIteration(id: string | null): void
  openItem(id: number | null): void
  setRepo(id: string): void
  setPaletteOpen(open: boolean): void
  setSettingsOpen(open: boolean): void
  setFilters(patch: Partial<Filters>): void
  clearFilters(): void
  setGroupBy(g: GroupBy): void
  toggleCollapsed(key: string): void
  setAllCollapsed(keys: string[], collapsed: boolean): void
  setTheme(t: ThemePref): void
  toggleSidebar(): void
  setBacklogLevel(id: string): void
  setBacklogShowParents(v: boolean): void
  setBacklogShowCompleted(v: boolean): void
  setNotifications(p: NotificationPref): void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      connection: null,
      writeMode: 'off',
      create: null,
      templatesOpen: false,
      view: 'board',
      iterationId: null,
      drawerId: null,
      repoId: null,
      paletteOpen: false,
      settingsOpen: false,
      filters: emptyFilters,
      groupBy: 'parent',
      collapsed: {},
      theme: 'system',
      sidebarCollapsed: false,
      backlogLevelId: null,
      backlogShowParents: false,
      backlogShowCompleted: false,
      notifications: 'unset',

      setConnection: (connection) => set({ connection, iterationId: null, backlogLevelId: null, filters: emptyFilters }),
      setWriteMode: (writeMode) => set({ writeMode }),
      openCreate: (create) => set({ create }),
      setTemplatesOpen: (templatesOpen) => set({ templatesOpen }),
      setView: (view) => set({ view }),
      setIteration: (iterationId) => set({ iterationId, view: 'board' }),
      openItem: (drawerId) => set({ drawerId }),
      setRepo: (repoId) => set({ repoId, view: 'repo' }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
      clearFilters: () => set({ filters: emptyFilters }),
      setGroupBy: (groupBy) => set({ groupBy }),
      toggleCollapsed: (key) => set((s) => ({ collapsed: { ...s.collapsed, [key]: !s.collapsed[key] } })),
      setAllCollapsed: (keys, value) =>
        set((s) => ({ collapsed: { ...s.collapsed, ...Object.fromEntries(keys.map((k) => [k, value])) } })),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setBacklogLevel: (backlogLevelId) => set({ backlogLevelId, view: 'backlog' }),
      setBacklogShowParents: (backlogShowParents) => set({ backlogShowParents }),
      setBacklogShowCompleted: (backlogShowCompleted) => set({ backlogShowCompleted }),
      setNotifications: (notifications) => set({ notifications })
    }),
    {
      name: 'ado-board-ui',
      storage: createJSONStorage(() => localStorage),
      // Only view preferences persist; the connection always comes from the main process.
      partialize: (s) => ({
        view: s.view,
        repoId: s.repoId,
        groupBy: s.groupBy,
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
        collapsed: s.collapsed,
        backlogShowParents: s.backlogShowParents,
        backlogShowCompleted: s.backlogShowCompleted,
        notifications: s.notifications
      })
    }
  )
)

export const isFiltering = (f: Filters) =>
  !!f.text || f.mine || f.assignees.length > 0 || f.types.length > 0 || f.tags.length > 0

export const useCanEdit = () => useUi((s) => s.writeMode !== 'off')

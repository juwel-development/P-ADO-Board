import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PanelLeft } from 'lucide-react'
import type { SettingsState } from '@shared/ipc'
import { CommandPalette } from './components/CommandPalette'
import { ConnectForm } from './components/ConnectForm'
import { CreateDialog } from './components/CreateDialog'
import { NotificationPrompt } from './components/NotificationSetup'
import { Sidebar } from './components/Sidebar'
import { Spinner } from './components/ui'
import { TemplatesDialog } from './components/Templates'
import { Toaster } from './components/Toaster'
import { WorkItemDrawer } from './components/WorkItemDrawer'
import { AdoError } from './lib/api'
import { useRegisterUndo } from './lib/mutations'
import { useIterations, useMeta } from './lib/queries'
import { useUi } from './lib/store'
import { useWatcher } from './lib/watch'
import { cn } from './lib/utils'
import { Backlog } from './views/Backlog'
import { Inbox } from './views/Inbox'
import { PullRequests } from './views/PullRequests'
import { SprintBoard } from './views/SprintBoard'

function useTheme() {
  const theme = useUi((s) => s.theme)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches))
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

function useShortcuts() {
  const qc = useQueryClient()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState()
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ui.setPaletteOpen(!ui.paletteOpen)
        return
      }
      if (mod && e.key === '\\') {
        e.preventDefault()
        ui.toggleSidebar()
        return
      }
      const el = document.activeElement
      if (mod || e.altKey || ui.paletteOpen || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      if ((el as HTMLElement | null)?.isContentEditable || document.querySelector('[data-dialog-open], [data-popover-open]')) return
      if (e.key === 'r') void qc.invalidateQueries()
      if (e.key === 'c' && ui.writeMode !== 'off' && !ui.create && ui.drawerId === null) {
        e.preventDefault()
        ui.openCreate({})
      }
      if (e.key === '1') ui.setView('board')
      if (e.key === '2') ui.setView('backlog')
      if (e.key === '3') ui.setView('inbox')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [qc])
}

export function App() {
  useTheme()
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const { connection, setConnection, settingsOpen, setSettingsOpen } = useUi()
  const qc = useQueryClient()

  useEffect(() => {
    void window.ado.getSettings().then((s) => {
      setSettings(s)
      useUi.getState().setWriteMode(s.writeMode)
      if (s.connection && s.hasPat) setConnection(s.connection)
    })
  }, [setConnection])

  const onSaved = (s: SettingsState) => {
    setSettings(s)
    useUi.getState().setWriteMode(s.writeMode)
    setSettingsOpen(false)
    qc.clear()
    setConnection(s.connection)
  }

  if (!settings) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner size={20} />
      </div>
    )
  }

  if (!connection) {
    return (
      <div className="drag grid h-full place-items-center bg-[radial-gradient(ellipse_at_top,var(--accent-soft),transparent_60%)] p-6">
        <div className="no-drag w-full max-w-[520px]">
          <ConnectForm initial={settings} onSaved={onSaved} />
        </div>
      </div>
    )
  }

  return (
    <>
      <Shell />
      {settingsOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-6 backdrop-blur-sm" onMouseDown={() => setSettingsOpen(false)}>
          <div className="animate-pop-in w-full max-w-[520px]" onMouseDown={(e) => e.stopPropagation()}>
            <ConnectForm initial={settings} onSaved={onSaved} onCancel={() => setSettingsOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}

function Shell() {
  useShortcuts()
  useRegisterUndo()
  useWatcher()
  const ui = useUi()
  const meta = useMeta()
  const iterations = useIterations()

  // Default selections once metadata is available: current sprint, requirement backlog.
  useEffect(() => {
    if (!ui.iterationId && iterations.data?.length) {
      const current = iterations.data.find((i) => i.attributes.timeFrame === 'current') ?? iterations.data.at(-1)
      if (current) useUi.setState({ iterationId: current.id })
    }
  }, [iterations.data, ui.iterationId])
  useEffect(() => {
    if (!ui.backlogLevelId && meta.data) useUi.setState({ backlogLevelId: meta.data.config.requirementBacklog.id })
  }, [meta.data, ui.backlogLevelId])

  const authError = [meta.error, iterations.error].find((e) => e instanceof AdoError && e.status === 401)
  useEffect(() => {
    if (authError) useUi.getState().setSettingsOpen(true)
  }, [authError])

  const isMac = window.ado.platform === 'darwin'
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Thin draggable title strip so the window can be moved from the content area. */}
        <div className={cn('drag flex h-8 shrink-0 items-center', ui.sidebarCollapsed && isMac && 'pl-[84px]')}>
          {ui.sidebarCollapsed && (
            <button onClick={ui.toggleSidebar} className="no-drag ml-2 rounded-md p-1 text-faint hover:bg-surface-2 hover:text-fg" title="Show sidebar  (⌘\)">
              <PanelLeft size={15} />
            </button>
          )}
        </div>
        <NotificationPrompt />
        <div className="min-h-0 flex-1">
          {ui.view === 'board' ? <SprintBoard /> : ui.view === 'inbox' ? <Inbox /> : ui.view === 'repo' ? <PullRequests /> : <Backlog />}
        </div>
      </main>
      <WorkItemDrawer />
      <CreateDialog />
      <TemplatesDialog />
      <Toaster />
      <CommandPalette />
    </div>
  )
}

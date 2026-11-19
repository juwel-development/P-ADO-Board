import { useEffect, useState } from 'react'
import { Bell, BellOff, BellRing, Settings, X } from 'lucide-react'
import { create } from 'zustand'
import { useUi } from '@/lib/store'
import { toast } from '@/lib/toasts'
import { Button, Spinner } from './ui'

// Desktop notifications are opt-in: macOS shows its permission dialog the first time the app posts a
// notification, so we post a test one right when the user asks for it instead of on the first change.

type Phase = 'idle' | 'waiting' | 'blocked'

const usePhase = create<{ phase: Phase; error?: string }>()(() => ({ phase: 'idle' }))

const isMac = () => window.ado.platform === 'darwin'
const osName = () => (isMac() ? 'macOS' : 'your system')
const settingsName = () => (isMac() ? 'System Settings' : 'Settings')

export async function enableNotifications() {
  if (usePhase.getState().phase === 'waiting') return
  usePhase.setState({ phase: 'waiting', error: undefined })
  const result = await window.ado.testNotification().catch((e: Error) => ({ status: 'failed' as const, error: e.message }))
  const ui = useUi.getState()
  if (result.status === 'shown') {
    usePhase.setState({ phase: 'idle' })
    ui.setNotifications('on')
    toast(
      {
        kind: 'success',
        message: 'Notifications are on',
        detail: `You should see a test notification now. If it didn’t appear, allow it in ${settingsName()} → Notifications.`,
        action: { label: 'Open settings', run: () => void window.ado.openNotificationSettings() }
      },
      9000
    )
  } else if (result.status === 'unsupported') {
    usePhase.setState({ phase: 'idle' })
    ui.setNotifications('off')
    toast({ kind: 'error', message: 'Desktop notifications aren’t supported here', detail: 'Updates still show up in the Inbox.' })
  } else {
    usePhase.setState({ phase: 'blocked', error: result.status === 'timeout' ? `${osName()} didn’t answer.` : result.error })
    ui.setNotifications('off')
  }
}

/** One-time card after connecting: asks to turn notifications on (and helps when the OS blocks them). */
export function NotificationPrompt() {
  const pref = useUi((s) => s.notifications)
  const { phase, error } = usePhase()
  const [visible, setVisible] = useState(false)

  // Let the app settle first so the card doesn't compete with the initial load.
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 1200)
    return () => clearTimeout(t)
  }, [])

  if (!visible || (pref !== 'unset' && phase !== 'blocked' && phase !== 'waiting')) return null
  const dismiss = () => {
    usePhase.setState({ phase: 'idle' })
    if (useUi.getState().notifications === 'unset') useUi.getState().setNotifications('off')
  }

  return (
    <div className="animate-pop-in absolute bottom-4 left-4 z-30 w-[360px] rounded-xl border border-line bg-surface p-4 shadow-pop">
      <button onClick={dismiss} className="absolute top-2.5 right-2.5 rounded-md p-1 text-faint hover:bg-surface-2 hover:text-fg" title="Close">
        <X size={14} />
      </button>
      {phase === 'blocked' ? (
        <>
          <div className="flex items-center gap-2.5 pr-6">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300">
              <BellOff size={16} />
            </span>
            <div className="text-[13.5px] font-semibold">{isMac() ? 'macOS' : 'Your system'} didn’t allow notifications</div>
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            Open {settingsName()} → Notifications, select <b>ADO Board</b> (listed as <b>Electron</b> while developing) and turn on
            <i> Allow notifications</i>. Then try again.
          </p>
          {error && /UNErrorDomain error 1/.test(error) && (
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              macOS refused without asking. If <b>Electron</b> isn’t listed there or is already allowed, the development build’s
              signature is broken: run <code>npm install</code> (it repairs it) and restart.
            </p>
          )}
          {error && <p className="mt-1 text-[11px] text-faint select-text">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button variant="primary" className="h-8 px-3" onClick={() => void window.ado.openNotificationSettings()}>
              <Settings size={13} /> Open {settingsName()}
            </Button>
            <Button variant="outline" className="h-8 px-3" onClick={() => void enableNotifications()}>
              Try again
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2.5 pr-6">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-fg">
              <BellRing size={16} />
            </span>
            <div className="text-[13.5px] font-semibold">Get notified about changes?</div>
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            ADO Board can notify you when someone changes or comments on an item you follow, even when it’s in the background.{' '}
            {phase === 'waiting' ? (
              <b className="text-fg">Choose “Allow” in the {osName()} dialog.</b>
            ) : (
              <>{isMac() ? 'macOS' : 'Your system'} will ask for permission next.</>
            )}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="primary" className="h-8 px-3" disabled={phase === 'waiting'} onClick={() => void enableNotifications()}>
              {phase === 'waiting' ? <Spinner size={13} className="text-white" /> : <Bell size={13} />}
              {phase === 'waiting' ? `Waiting for ${osName()}…` : 'Turn on notifications'}
            </Button>
            <Button className="h-8 px-3" onClick={dismiss}>
              Not now
            </Button>
          </div>
          <p className="mt-2.5 text-[11px] text-faint">You can change this later in the Inbox.</p>
        </>
      )}
    </div>
  )
}

/** Inbox header control: shows whether desktop notifications are on and toggles them. */
export function NotificationToggle() {
  const pref = useUi((s) => s.notifications)
  const phase = usePhase((s) => s.phase)
  const on = pref === 'on'
  return (
    <Button
      variant="outline"
      disabled={phase === 'waiting'}
      onClick={() => (on ? useUi.getState().setNotifications('off') : void enableNotifications())}
      title={on ? 'Desktop notifications are on. Click to turn them off (the Inbox keeps working).' : 'Turn on desktop notifications'}
    >
      {phase === 'waiting' ? <Spinner size={13} /> : on ? <Bell size={13} className="fill-current text-accent-fg" /> : <BellOff size={13} />}
      {on ? 'Notifications on' : 'Notifications off'}
    </Button>
  )
}

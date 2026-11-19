import { useMemo, useState } from 'react'
import { ArrowUpRight, Check, Eye, EyeOff, Kanban, X } from 'lucide-react'
import type { Connection, SettingsState } from '@shared/ipc'
import { probeProjects, probeTeams } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button, Spinner } from './ui'

const TOKEN_HINT = 'Scopes: Work Items (Read), Project and Team (Read)'

interface Props {
  initial: SettingsState
  onSaved(state: SettingsState): void
  onCancel?(): void
}

type Named = { id: string; name: string }

export function ConnectForm({ initial, onSaved, onCancel }: Props) {
  const [orgUrl, setOrgUrl] = useState(initial.connection?.orgUrl ?? '')
  const [pat, setPat] = useState('')
  const [showPat, setShowPat] = useState(false)
  const [projects, setProjects] = useState<Named[] | null>(null)
  const [teams, setTeams] = useState<Named[] | null>(null)
  const [project, setProject] = useState(initial.connection?.project ?? '')
  const [team, setTeam] = useState(initial.connection?.team ?? '')
  const [busy, setBusy] = useState<'connect' | 'teams' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const normalizedOrg = orgUrl.trim().replace(/\/+$/, '')
  const patArg = pat.trim() || undefined
  const canConnect = /^https:\/\/.+/.test(normalizedOrg) && (!!patArg || initial.hasPat)

  async function connect() {
    setBusy('connect')
    setError(null)
    try {
      const list = await probeProjects(normalizedOrg, patArg)
      setProjects(list)
      const keep = list.find((p) => p.name === project)
      if (keep) await loadTeams(keep.name)
      else if (list.length === 1) await loadTeams(list[0].name)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function loadTeams(name: string) {
    setProject(name)
    setTeams(null)
    setBusy('teams')
    setError(null)
    try {
      const list = await probeTeams(normalizedOrg, name, patArg)
      setTeams(list)
      if (!list.some((t) => t.name === team)) setTeam(list.length === 1 ? list[0].name : '')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    setBusy('save')
    try {
      const connection: Connection = { orgUrl: normalizedOrg, project, team }
      onSaved(await window.ado.saveSettings({ connection, pat: patArg }))
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
    }
  }

  return (
    <div className="w-full max-w-[520px] rounded-2xl border border-line bg-surface p-7 shadow-pop">
      <div className="mb-6 flex items-start gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-accent text-white shadow-card">
          <Kanban size={20} />
        </div>
        <div className="flex-1">
          <h1 className="text-[17px] font-semibold tracking-tight">Connect to Azure DevOps</h1>
          <p className="text-muted">Read-only. Your token is encrypted with the OS keychain and never leaves this machine.</p>
        </div>
        {onCancel && (
          <button onClick={onCancel} className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-fg">
            <X size={16} />
          </button>
        )}
      </div>

      <Field label="Organization URL">
        <input
          value={orgUrl}
          onChange={(e) => setOrgUrl(e.target.value)}
          placeholder="https://dev.azure.com/your-org"
          className={inputCls}
          spellCheck={false}
        />
      </Field>

      <Field
        label="Personal access token"
        hint={
          <span className="flex items-center gap-1">
            {TOKEN_HINT}
            {/^https:\/\//.test(normalizedOrg) && (
              <button
                className="inline-flex items-center text-accent-fg hover:underline"
                onClick={() => window.ado.openExternal(`${normalizedOrg}/_usersSettings/tokens`)}
              >
                · create one <ArrowUpRight size={12} />
              </button>
            )}
          </span>
        }
      >
        <div className="relative">
          <input
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            type={showPat ? 'text' : 'password'}
            placeholder={initial.hasPat ? '•••••••• stored — leave empty to keep' : 'Paste your PAT'}
            className={cn(inputCls, 'pr-9 font-mono')}
            spellCheck={false}
            onKeyDown={(e) => e.key === 'Enter' && canConnect && connect()}
          />
          <button
            onClick={() => setShowPat((s) => !s)}
            className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-faint hover:text-fg"
            tabIndex={-1}
          >
            {showPat ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </Field>

      {!projects && (
        <Button variant="primary" className="mt-2 h-9 w-full justify-center" disabled={!canConnect || !!busy} onClick={connect}>
          {busy === 'connect' ? <Spinner className="text-white" /> : 'Connect'}
        </Button>
      )}

      {projects && (
        <div className="animate-fade-in mt-2 grid grid-cols-2 gap-3">
          <Picker label="Project" items={projects} value={project} onPick={loadTeams} />
          <Picker
            label="Team"
            items={teams ?? []}
            value={team}
            onPick={setTeam}
            loading={busy === 'teams'}
            placeholder={project ? undefined : 'Pick a project first'}
          />
        </div>
      )}

      {error && <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-red-600 select-text dark:text-red-400">{error}</div>}

      {projects && (
        <div className="mt-5 flex justify-end gap-2">
          {onCancel && <Button onClick={onCancel}>Cancel</Button>}
          <Button variant="primary" className="h-8 px-4" disabled={!project || !team || !!busy} onClick={save}>
            {busy === 'save' ? <Spinner className="text-white" /> : <Check size={14} />}
            Open board
          </Button>
        </div>
      )}
    </div>
  )
}

const inputCls =
  'h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-[13px] text-fg outline-none transition placeholder:text-faint focus:border-accent focus:bg-surface focus:ring-3 focus:ring-[var(--ring)] select-text'

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <div className="mb-1.5 text-[12px] font-medium text-muted">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-[11.5px] text-faint">{hint}</div>}
    </label>
  )
}

function Picker({
  label,
  items,
  value,
  onPick,
  loading,
  placeholder
}: {
  label: string
  items: Named[]
  value: string
  onPick(name: string): void
  loading?: boolean
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())), [items, q])
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-muted">{label}</div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder ?? `Search ${items.length} ${label.toLowerCase()}s…`}
          className="h-8 w-full border-b border-line bg-transparent px-3 text-[12.5px] outline-none placeholder:text-faint"
          disabled={!items.length}
        />
        <div className="h-48 overflow-y-auto p-1">
          {loading && (
            <div className="grid h-full place-items-center">
              <Spinner />
            </div>
          )}
          {shown.map((i) => (
            <button
              key={i.id}
              onClick={() => onPick(i.name)}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px]',
                value === i.name ? 'bg-accent-soft font-medium text-accent-fg' : 'hover:bg-surface-3'
              )}
            >
              <span className="truncate">{i.name}</span>
              {value === i.name && <Check size={13} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

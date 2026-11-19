import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Connection, SettingsState } from '@shared/ipc'
import { parseWriteMode } from './guard'

const settingsFile = () => join(app.getPath('userData'), 'settings.json')
const patFile = () => join(app.getPath('userData'), 'pat.bin')

export function readConnection(): Connection | null {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8')).connection ?? null
  } catch {
    return null
  }
}

export function writeConnection(connection: Connection): void {
  writeFileSync(settingsFile(), JSON.stringify({ connection }, null, 2))
}

export function readPat(): string | null {
  const fromEnv = () => devEnv('ADO_PAT') ?? devEnv('PAT')
  if (!existsSync(patFile())) return fromEnv()
  try {
    return safeStorage.decryptString(readFileSync(patFile()))
  } catch {
    return fromEnv()
  }
}

/** Unpackaged (dev) builds read fallbacks (`PAT`, `ADO_BOARD_WRITES`) from the project's gitignored `.env`. */
function devEnv(key: string): string | null {
  if (app.isPackaged) return null
  try {
    const env = readFileSync(join(app.getAppPath(), '.env'), 'utf8')
    return env.match(new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"'\\s]+)`, 'm'))?.[1] ?? null
  } catch {
    return null
  }
}

export function writePat(pat: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption (Keychain) is not available; refusing to store the PAT in plain text.')
  }
  writeFileSync(patFile(), safeStorage.encryptString(pat), { mode: 0o600 })
}

export function clearPat(): void {
  rmSync(patFile(), { force: true })
}

export const writeMode = () => parseWriteMode(process.env.ADO_BOARD_WRITES ?? devEnv('ADO_BOARD_WRITES') ?? undefined)

export function settingsState(): SettingsState {
  return { connection: readConnection(), hasPat: readPat() !== null, writeMode: writeMode() }
}

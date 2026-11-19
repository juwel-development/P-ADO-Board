import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Subscription state (subscribed items, last seen revisions, inbox) per org + project, in one JSON file.

const MAX_BYTES = 5 * 1024 * 1024

const file = (dir: string) => join(dir, 'subscriptions.json')

function readAll(dir: string): Record<string, unknown> {
  if (!existsSync(file(dir))) return {}
  try {
    const all = JSON.parse(readFileSync(file(dir), 'utf8'))
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {}
  } catch {
    return {}
  }
}

const validScope = (scope: unknown): scope is string => typeof scope === 'string' && scope.length > 0 && scope.length <= 400

export function loadWatch(dir: string, scope: unknown): unknown | null {
  return validScope(scope) ? (readAll(dir)[scope] ?? null) : null
}

export function saveWatch(dir: string, scope: unknown, data: unknown): void {
  if (!validScope(scope) || !data || typeof data !== 'object') throw new Error('Invalid subscription data.')
  const json = JSON.stringify({ ...readAll(dir), [scope]: data })
  if (json.length > MAX_BYTES) throw new Error('Subscription data is too large.')
  // Write-then-rename so a crash mid-write never leaves a truncated file.
  const tmp = `${file(dir)}.tmp`
  writeFileSync(tmp, json)
  renameSync(tmp, file(dir))
}

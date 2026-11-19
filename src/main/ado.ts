import type { AdoRequest, AdoResult } from '@shared/ipc'
import { checkRequest } from './guard'
import { readConnection, readPat, writeMode } from './settings'

const API_VERSION = '7.1'

const authHeader = (pat: string) => `Basic ${Buffer.from(`:${pat}`).toString('base64')}`

function resolveCredentials(probe?: AdoRequest['probe']) {
  const orgUrl = (probe?.orgUrl ?? readConnection()?.orgUrl ?? '').replace(/\/+$/, '')
  const pat = probe?.pat ?? readPat()
  return { orgUrl, pat }
}

/** https://dev.azure.com/org → https://vssps.dev.azure.com/org; https://org.visualstudio.com → https://org.vssps.visualstudio.com */
function serviceUrl(orgUrl: string, service: string): string {
  const u = new URL(orgUrl)
  u.hostname = u.hostname === 'dev.azure.com' ? `${service}.dev.azure.com` : u.hostname.replace(/\.visualstudio\.com$/, `.${service}.visualstudio.com`)
  return u.toString().replace(/\/+$/, '')
}

export async function adoRequest(req: AdoRequest): Promise<AdoResult> {
  const method = req.method ?? 'GET'
  const mode = writeMode()
  const verdict = checkRequest(method, req.path, mode)
  if (!verdict.allow) return { ok: false, status: 0, message: `Blocked: ${verdict.reason}` }
  // Writes never go to the service hosts or to an org the user is still probing.
  if (verdict.kind !== 'read' && (req.service || req.probe)) return { ok: false, status: 0, message: 'Blocked: unexpected write target.' }

  const dryRun = verdict.kind !== 'read' && mode === 'validate'
  if (dryRun && verdict.kind === 'reorder') {
    // The reorder endpoint has no validate-only option; report success without sending anything.
    const ids = (req.body as { ids?: number[] })?.ids ?? []
    return { ok: true, dryRun, data: { count: ids.length, value: ids.map((id) => ({ id, order: 0 })) } }
  }
  if (dryRun && verdict.kind === 'comment') {
    // Comments have no validate-only option; echo the comment back without sending it.
    const text = (req.body as { text?: string })?.text ?? ''
    return {
      ok: true,
      dryRun,
      data: { id: -Date.now(), text, format: 'markdown', createdBy: { displayName: 'Validation only' }, createdDate: new Date().toISOString() }
    }
  }

  const { orgUrl, pat } = resolveCredentials(req.probe)
  if (!orgUrl || !pat) return { ok: false, status: 401, message: 'Not connected. Add your organization URL and PAT.' }
  if (!/^https:\/\//i.test(orgUrl)) return { ok: false, status: 0, message: 'Organization URL must start with https://' }

  const url = new URL((req.service ? serviceUrl(orgUrl, req.service) : orgUrl) + req.path)
  for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v))
  if (!url.searchParams.has('api-version')) url.searchParams.set('api-version', API_VERSION)
  if (dryRun) url.searchParams.set('validateOnly', 'true')
  const isPatchDoc = verdict.kind === 'update' || verdict.kind === 'create'

  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader(pat),
        Accept: 'application/json',
        ...(req.body !== undefined ? { 'Content-Type': isPatchDoc ? 'application/json-patch+json' : 'application/json' } : {})
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      redirect: 'manual'
    })

    // ADO answers an invalid PAT with 203 + an HTML sign-in page, or a redirect.
    if (res.status === 203 || (res.status >= 300 && res.status < 400)) {
      return { ok: false, status: 401, message: 'Authentication failed. Check that the PAT is valid and not expired.' }
    }
    const text = await res.text()
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`
      try {
        message = JSON.parse(text).message ?? message
      } catch {
        /* keep status text */
      }
      return { ok: false, status: res.status, message }
    }
    return { ok: true, data: text ? JSON.parse(text) : null, ...(dryRun ? { dryRun } : {}) }
  } catch (err) {
    return { ok: false, status: 0, message: `Network error: ${(err as Error).message}. Are you on the VPN/online?` }
  }
}

/** Fetches an authenticated image (avatar, attachment) — only from the configured org's host. */
export async function fetchAsset(target: string): Promise<Response> {
  const { orgUrl, pat } = resolveCredentials()
  if (!orgUrl || !pat) return new Response(null, { status: 401 })
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return new Response(null, { status: 400 })
  }
  const orgHost = new URL(orgUrl).hostname
  const allowed = url.protocol === 'https:' && (url.hostname === orgHost || url.hostname.endsWith('.visualstudio.com'))
  if (!allowed) return new Response(null, { status: 403 })
  const res = await fetch(url, { headers: { Authorization: authHeader(pat) }, redirect: 'manual' })
  if (!res.ok || res.status === 203) return new Response(null, { status: res.status === 203 ? 401 : res.status })
  return new Response(res.body, {
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream', 'Cache-Control': 'max-age=3600' }
  })
}

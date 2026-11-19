// The Electron.app that npm extracts on macOS can carry a broken ad-hoc signature. macOS then refuses
// notification permission without asking (UNErrorDomain error 1). Re-sign it ad-hoc when the signature
// doesn't verify. Dev builds only; never fails the install.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

if (process.platform === 'darwin') {
  const app = join(import.meta.dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app')
  const run = (...args) => execFileSync('codesign', args, { stdio: 'pipe' })
  if (existsSync(app)) {
    try {
      run('--verify', '--deep', '--strict', app)
    } catch {
      try {
        run('--force', '--deep', '--sign', '-', app)
        console.log('Re-signed node_modules Electron.app (ad-hoc) so macOS notifications can be allowed.')
      } catch (e) {
        console.warn(`Could not re-sign Electron.app: ${e.message}`)
      }
    }
  }
}

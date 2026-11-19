// electron-builder mac.sign hook.
// - Developer ID identity found (keychain, or CSC_LINK in CI): sign with it. electron-builder's own signer passes
//   the identity *name* to codesign, which fails for names with non-ASCII characters ("Lössl"); opts.identity
//   here is the certificate hash, which always matches.
// - No identity (anyone building without a certificate): sign ad-hoc so macOS accepts the bundle and can ask
//   for notification permission. Notarization is skipped then (no APPLE_API_* env vars).
const { execFileSync } = require('node:child_process')
const { signAsync } = require('@electron/osx-sign')

exports.default = async function signMac(opts) {
  if (opts.identity) return signAsync(opts)
  console.log('  • no Developer ID identity found, signing ad-hoc')
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', opts.app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', opts.app], { stdio: 'inherit' })
}

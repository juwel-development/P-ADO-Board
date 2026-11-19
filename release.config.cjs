// semantic-release: the version comes from the Conventional Commit messages since the last tag.
// Order matters within each step: package.json is bumped (npm) before the app is built (exec), so the build
// carries the new version, and the build exists before the release commit (git) and the upload (github).
module.exports = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
    // Bumps package.json / package-lock.json only; the package is private, nothing goes to npm.
    ['@semantic-release/npm', { npmPublish: false }],
    // Signs with CSC_LINK and notarizes with APPLE_API_KEY* (see .github/workflows/release.yml).
    ['@semantic-release/exec', { prepareCmd: 'npx electron-vite build && npx electron-builder --mac --publish never' }],
    [
      '@semantic-release/github',
      {
        // latest-mac.yml plus the zip and its blockmap are what electron-updater reads; the dmg is for people.
        assets: [
          'release/*.dmg',
          'release/*.zip',
          'release/*.blockmap',
          'release/latest-mac.yml'
        ]
      }
    ],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'package-lock.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]'
      }
    ]
  ]
}

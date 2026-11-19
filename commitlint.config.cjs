/** Conventional Commits. semantic-release derives the next version from these messages,
 *  so the type prefix is what decides patch vs minor vs major. */
module.exports = {
  extends: ['@commitlint/config-conventional']
}

// Which pull request events to report, from the active PRs of followed repositories and the PRs that
// have you as a reviewer. Pure (no requests, no React) so it can be tested in isolation.

import type { PullRequest } from './api'

export interface FollowedRepo {
  id: string
  name: string
  project: string
  since: string
  /** Only report PRs into these branches (names without `refs/heads/`); empty = any branch. */
  branches: string[]
}

export interface PullEvent {
  pr: PullRequest
  event: 'opened' | 'reviewer'
  required?: boolean
}

export interface PullState {
  /** Active PR ids per followed repo at the last check; absent = not checked yet (baseline). */
  prSeen: Record<string, number[]>
  /** Active PRs that had you as a reviewer at the last check; undefined = not checked yet. */
  reviewSeen?: number[]
}

export const branchName = (ref: string) => ref.replace(/^refs\/heads\//, '')

const sameId = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/**
 * `active` holds the active PRs of each repo that could be fetched (failed repos are missing and keep
 * their previous state); `toReview` is null when that query failed.
 */
export function diffPulls(
  repos: FollowedRepo[],
  active: Map<string, PullRequest[]>,
  toReview: PullRequest[] | null,
  state: PullState,
  meId: string
): { events: PullEvent[]; state: PullState } {
  const events: PullEvent[] = []
  const prSeen: Record<string, number[]> = {}

  for (const repo of repos) {
    const prs = active.get(repo.id)
    if (!prs) {
      if (state.prSeen[repo.id]) prSeen[repo.id] = state.prSeen[repo.id]
      continue
    }
    const seen = state.prSeen[repo.id]
    if (seen) {
      const known = new Set(seen)
      const wanted = new Set(repo.branches.map((b) => b.toLowerCase()))
      for (const pr of prs) {
        if (known.has(pr.pullRequestId) || sameId(pr.createdBy.id, meId)) continue
        if (wanted.size && !wanted.has(branchName(pr.targetRefName).toLowerCase())) continue
        events.push({ pr, event: 'opened' })
      }
    }
    prSeen[repo.id] = prs.map((p) => p.pullRequestId)
  }

  let reviewSeen = state.reviewSeen
  if (toReview) {
    if (reviewSeen) {
      const known = new Set(reviewSeen)
      for (const pr of toReview) {
        if (known.has(pr.pullRequestId) || sameId(pr.createdBy.id, meId)) continue
        const me = pr.reviewers?.find((r) => sameId(r.id, meId))
        events.push({ pr, event: 'reviewer', required: !!me?.isRequired })
      }
    }
    reviewSeen = toReview.map((p) => p.pullRequestId)
  }

  return { events, state: { prSeen, reviewSeen } }
}

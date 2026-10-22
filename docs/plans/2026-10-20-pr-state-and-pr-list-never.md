# Bitbucket pr-state and pr-list answer mergeable

> On Bitbucket, `pr-list` rows read `mergeable: unknown` and `pr-state` has no `mergeable` field, so a desk never learns that its PR conflicts with the base branch.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #2156
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2167 merged
- **Started:** 2026-10-20, Jan Wloka, `bug/pr-state-and-pr-list-never`
- **Delivered:** 2026-10-20
- **Released:** 2026-10-22, v2.28.0

## Changelog

- Bitbucket `pr-list` and `pr-state` report `mergeable` (`mergeable`, `conflicting` or `unknown`) from the Bitbucket API, so the desk's merge-main-on-conflict path starts on Bitbucket.

<!-- Board impact: none expected. The board reads `mergeable` from the pulse as before; only the value on Bitbucket changes. -->

## Motivation

Field test on 2026-10-20 against ewz-kus-portal: every Bitbucket `pr-list` row reads `mergeable: unknown`, and `pr-state` carries no `mergeable` field. The `MERGEABLE_OF` fold in `skills/plot/scripts/plot-host.sh` (added in #2136) reads GitHub's `mergeable`, `mergeStateStatus` and `mergeable_state`. A Bitbucket payload carries none of them, so the fold returns `unknown` by design.

Two consumers lose their signal:

- The desk path "merge main when the PR conflicts" (`packages/fleet/src/server/entry/worker-loop.ts`, `pr.mergeable === 'conflicting'`) never starts on Bitbucket.
- The merge controller's pre-check cannot use the field.

## Design

### Approach

Choose one of two outcomes. The issue names both.

1. **Bitbucket answers.** The Bitbucket arm of `pr-list --rich` and `pr-state` asks an endpoint that reports conflicts and folds the answer into the same three words. Candidates to measure first: the PR diffstat (`/2.0/repositories/{workspace}/{repo}/pullrequests/{id}/diffstat`, entries carry a `status` such as `merge conflict`) and the PR merge-check or `conflicts` information on the PR object. Each costs one extra request per PR, so the rate-limit contract of the host connector applies: the answer must come from a bounded number of calls per pass, and a row the pass does not reach reads `unknown`, as the Jenkins binding already does for rows past its cap.
2. **The field stays `unknown` and is documented.** The connector contract in `plot-host.sh` states that Bitbucket never answers `mergeable`, and the desk path uses another signal (for example a failed `git merge-tree` or a failed merge of the base into the branch in the desk's worktree).

Open for the reader to decide: outcome 1 costs requests on a connector with a rate limit; outcome 2 costs a second code path in the desk loop. A measurement of both endpoints against ewz-kus-portal comes before the choice.

The fold stays in one place: any new Bitbucket mapping extends `MERGEABLE_OF` or sits beside it, and the GitHub mapping does not change. Tests cover the Bitbucket arm with a fixture per endpoint answer (clean, conflicting, endpoint failure) and assert that `pr-state` carries the field.

### Open Questions

- [ ] Which Bitbucket endpoint answers conflicts without a per-PR request on the list path, if any?
- [ ] Is one extra request per open PR per pass affordable inside the Bitbucket request budget?
- [ ] If the field stays `unknown`, which signal does the desk path use, and is it available without a PR?

## Slices

### Bitbucket mergeable

- `bug/pr-state-and-pr-list-never` — Measure the Bitbucket conflict endpoints, then fold the answer into `pr-list --rich` and `pr-state`, or document `unknown` and give the desk another signal. → #2176

## Notes

Source: https://github.com/plot-pm/plot/issues/2156

# PR and issue reads still use GraphQL

> `plot-host.sh pr-list`, `pr-merged`, `issue-view`, `issue-list` and `default-branch` read over REST only on GitHub, so the approve, idea and fleet controllers keep reading while GitHub's GraphQL limit is spent.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** #3317
- **Review:** pr
- **Impl:** own branches

## Changelog

- The GitHub arms of `plot-host.sh` read the PR list, a branch's merged state, one issue, the issue list and the default branch over REST, so a refused GraphQL call no longer stops `/plot-approve`, `/plot-idea` or the fleet scan from reading.

Board impact: none expected. Each op prints the JSON it prints today. Confirm at implementation that the board's reads (`pr-list`, `issue-list`) see no changed field.

## Motivation

#3271 moved `pr-review`, `pr-merge`, `commit-status` and `pr-state` to REST, and `issue-writes-have-a-rest-route` moves `issue-comment` and `issue-label`. Five read ops still call GraphQL-backed `gh` subcommands. While GitHub's secondary GraphQL limit is active, they fail although the REST quota is nearly full.

Measured on this repository, 2026-11-08 and 2026-11-09 (issue #3317):

- The approve controller refused five times between 14:25 and 14:34 on 2026-11-09 with `the host could not list its open PRs to find the one that changes the plan (plot-host.sh pr-list refused the call)`, and twice more for other plans the same day.
- The approve controller refused `state-branch` with `spike-unmerged … (the host could not say)`, because `pr-merged` answered `unknown`.
- The idea controller refused issues #3265, #3274, #3293 and #3306 with `issue-unreadable … GraphQL: API rate limit already exceeded`.
- The fleet reading showed `cannot read the PR — the host could not be asked` for one slice.

| Op | GitHub call today | Call sites on `ca37e53ba` (`skills/plot/scripts/plot-host.sh`) |
|---|---|---|
| `pr-list` | `gh pr list --state …` through `pr_list_call` | `:4738`, `:4783`, `:4814` |
| `pr-merged` | `gh pr list --head <ref> --state all` | `:4212`, `:4286`, `:4338` |
| `issue-view` | `gh issue view <n> --json …` | `:5596` |
| `issue-list` | `gh issue list --state …` | `:5472` |
| `default-branch` | `gh repo view --json defaultBranchRef` | `:3984` |

## Design

### Approach

- **REST only on GitHub, as #3271 did.** No route switch and no fallback: each op calls REST every time, so each has one path to test. The Bitbucket arms do not change.
- **`pr-list`:** `GET repos/{owner}/{repo}/pulls?state=…&head=…&per_page=…`, paged. `--since` reads `updated_at`. `--rich` fields and the whole-page notice keep the shape the fleet scan reads today.
- **`pr-merged`:** `GET repos/{owner}/{repo}/pulls?state=all&head={owner}:{branch}`, reading `merged_at` and `merge_commit_sha`. The answer stays `mergedAt`, never `state` (see *One Answer To "Did This Land"* in `CLAUDE.md`).
- **`issue-view`:** `GET repos/{owner}/{repo}/issues/<n>`.
- **`issue-list`:** `GET repos/{owner}/{repo}/issues?state=…`, dropping entries that carry a `pull_request` key, because the REST issues endpoint also returns pull requests.
- **`default-branch`:** `GET repos/{owner}/{repo}` and `default_branch`, or the `origin/HEAD` symbolic ref with no host call.
- **Repository name:** `gh_origin_slug` (read from the git remote, no API call), as #3271 does.
- **Same output as before.** Each op prints the JSON it prints today, so no caller changes.
- **Bash 3.2**, and the shell-line ratchet: added lines are paid for by removing an equal number of shipped shell lines (`scripts/check-shell-lines.sh pr`).
- **`check-host-cli-callers.sh`** keeps passing: every call stays inside `plot-host.sh`.

### Open Questions

- [x] `default-branch`: the `origin/HEAD` symbolic ref costs no call but is absent in a clone that never set it, and goes stale when the host renames the branch. Choose REST, the ref, or the ref with a REST fallback when it is unset. → The `origin/HEAD` symbolic ref, with a REST fallback (`GET /repos/{owner}/{repo}`, `default_branch`) only when the ref is unset. The ref costs no call on the common path; `/plot-reconcile`'s fetch already runs `git remote set-head origin -a`, which repairs a renamed branch.
- [x] Field mapping: REST `pulls` returns `merged_at`, `head.ref`, `draft`, `updated_at` where `gh pr list --json` returned camelCase fields and derived ones (`statusCheckRollup`, `reviewDecision` for `--rich`). Which `--rich` fields have no REST source on the list endpoint, and does the scan need a per-PR call for them? → The REST list endpoint carries none of `checks`, `mergeable`, `review` or `failing_checks`, and a per-PR call for each open PR would add about 20 REST calls per scan at the 60 s beat, over 1,200 an hour. So the plain `pr-list` arm, `pr-merged`, `--since` and `--state merged` move to REST, and the `--rich` arm keeps its GraphQL call for those four fields. When GraphQL refuses, `--rich` answers the REST base fields and reports the four rich fields as unread (`checks: "unknown"`, `mergeable: "unknown"`, `review: ""`, `failing_checks: []`), never as passed: absent is not false. A test covers that fallback.
- [x] `--since` over REST: the `pulls` endpoint has no `since` parameter, so the filter runs client-side over `updated_at`. Does it stop paging early (`sort=updated&direction=desc`) to keep the request count at today's level? → Yes. The REST read asks `sort=updated&direction=desc` and stops paging at the first row whose `updated_at` is older than the watermark, so a delta costs one page in the common case, as today.
- [x] Does the slice split in two (PR reads; issue reads and `default-branch`)? One slice is simplest. A split is justified only if the `pr-list` mapping alone is large. → One slice. The `--rich` arm keeps GraphQL (answer above), so the `pr-list` change is the base-field mapping plus the fallback, which stays within one reviewable diff.

## Done when

| Claim | Check | Slice |
|---|---|---|
| No op fails while GraphQL refuses | a stub `gh` that fails `gh api graphql` and every GraphQL-backed subcommand (`pr list`, `issue view`, `issue list`, `repo view`); all five ops still answer, and `pr-list --rich` answers its base fields with the four rich fields unread | REST reads |
| The approve controller approves a plan whose PR is open | the stubbed run above through `plot-approve` | REST reads |
| The idea controller reads an issue | the stubbed run through the idea controller | REST reads |
| `pr-merged` answers `merged` for a merged branch | the stubbed run, reading `merged_at` | REST reads |
| Each op's REST shape is covered | rows in `test/reconcile/host.test.mjs` for each of the five ops | REST reads |
| Output is unchanged for callers | the existing `host.test.mjs` and fleet-scan rows pass with stubs moved to the REST calls | REST reads |
| The host-CLI gate and shell budget hold | `scripts/check-host-cli-callers.sh`, `scripts/check-shell-lines.sh pr` | REST reads |

## Slices

### REST reads

- `bug/pr-and-issue-reads-still-use` — REST bodies for `pr-list`, `pr-merged`, `issue-view`, `issue-list` and `default-branch` in `skills/plot/scripts/plot-host.sh`, contract rows in `test/reconcile/host.test.mjs`; a changeset for `plot` <!-- builds: REST routes for plot-host.sh pr-list, pr-merged, issue-view, issue-list and default-branch -->

## Notes

- Related: #3265 (#3271, `bug/github-arms-use-rest`), `issue-writes-have-a-rest-route`.
- Deliverable search found no existing REST route for these five ops.
- Definition of Done: docs/definition-of-done.md.

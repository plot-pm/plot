# PR and issue reads still use GraphQL

> `plot-host.sh pr-list`, `pr-merged`, `issue-view`, `issue-list` and `default-branch` read over REST on GitHub, and `pr-list --rich` falls back to REST when GraphQL refuses, so the approve, idea and fleet controllers keep reading while GitHub's GraphQL limit is spent.

## Status

- **State:** Approved
- **Type:** bug
- **Approved:** 2026-11-09, Jan Wloka, plan-PR #3318 merged
- **Sprint:** ship-2-32-0
- **Issue:** #3317
- **Review:** pr
- **Impl:** own branches

## Changelog

- The GitHub arms of `plot-host.sh` read the PR list, a branch's merged state, one issue, the issue list and the default branch over REST, so a refused GraphQL call no longer stops `/plot-approve`, `/plot-idea` or the fleet scan from reading. `pr-list --rich` still asks GraphQL for checks, mergeability and review; when GraphQL refuses, those fields read as unknown.

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

- **REST on GitHub, as #3271 did, with one exception.** `pr-list`'s plain arm, `pr-merged`, `issue-view`, `issue-list` and `default-branch` call REST every time, so each has one path to test, except `default-branch`, whose `origin/HEAD` fallback is a second path the Done-when table covers. `pr-list --rich` keeps its GraphQL call for the four rich fields and falls back to REST when GraphQL refuses (below). The Bitbucket arms do not change.
- **`pr-list`:** the plain arm reads `GET repos/{owner}/{repo}/pulls?state=…&head=…&per_page=…`, paged. `--since` asks `sort=updated&direction=desc` and stops paging at the first row older than the watermark. `--rich` keeps its GraphQL call; when GraphQL refuses, it answers the REST base fields with `checks: "unknown"`, `mergeable: "unknown"`, `review: ""` and `failing_checks: []`, never as passed. The whole-page notice keeps the shape the fleet scan reads today.
- **`pr-merged`:** `GET repos/{owner}/{repo}/pulls?state=all&head={owner}:{branch}`, reading `merged_at` and `merge_commit_sha`. The answer stays `mergedAt`, never `state` (see *One Answer To "Did This Land"* in `CLAUDE.md`).
- **`issue-view`:** `GET repos/{owner}/{repo}/issues/<n>`.
- **`issue-list`:** `GET repos/{owner}/{repo}/issues?state=…&sort=updated&direction=desc`, paged, dropping entries that carry a `pull_request` key, because the REST issues endpoint also returns pull requests. The three filters the GitHub arm builds as `--search` qualifiers today (`plot-host.sh:5462-5471`) run client-side, not through the search endpoint and its separate 30-per-minute limit:
  - `--title-has`: a case-insensitive substring match on `title` (`findOpenReviewIssue` reads it).
  - `--state closed` with a since date: the request passes `since=<date>` (which filters `updated_at`, a superset), and the arm keeps rows whose `closed_at` is on or after the date.
  - `--limit N`: the arm pages until it holds N issues after dropping pull requests, or the pages run out, so a page full of pull requests never shortens the answer.
  - `--label <name>`: the REST `labels=<name>` parameter (`tracker-shell.ts:351` reads it).
  - `--state changed` with a since date: `state=all&since=<timestamp>`, each row's status taken from its own `state` (`tracker-shell.ts:369` reads it).
  - A date-only `--since` (`YYYY-MM-DD`) becomes `YYYY-MM-DDT00:00:00Z` before it reaches REST, which accepts only a full ISO 8601 timestamp.
- **`default-branch`:** `GET repos/{owner}/{repo}` and `default_branch` first, as the op asks the host first today (`plot-host.sh:3962-3967`); the `origin/HEAD` symbolic ref stays the fallback when the host call fails. The order matters: `origin/HEAD` is a clone-time cache, and on 2026-09-24 a clone whose GitHub default had moved to `develop` kept `origin/HEAD → main`, so the board read two of three plans from the wrong branch.
- **Repository name:** `gh_origin_slug` (read from the git remote, no API call), as #3271 does.
- **Same output as before.** Each op prints the JSON it prints today, so no caller changes.
- **Bash 3.2**, and the shell-line ratchet: added lines are paid for by removing an equal number of shipped shell lines (`scripts/check-shell-lines.sh pr`).
- **`check-host-cli-callers.sh`** keeps passing: every call stays inside `plot-host.sh`.

### Open Questions

- [x] `default-branch`: the `origin/HEAD` symbolic ref costs no call but is absent in a clone that never set it, and goes stale when the host renames the branch. Choose REST, the ref, or the ref with a REST fallback when it is unset. → REST first: `GET repos/{owner}/{repo}` (`default_branch`), with the `origin/HEAD` ref as the fallback when the host call fails, keeping today's host-first order. The ref is a clone-time cache that nothing repairs after a rename while the old branch still exists (`repair_origin_head` in `plot-default-branch.sh:68-80` runs only when the ref does not resolve), so it cannot come first.
- [x] Field mapping: REST `pulls` returns `merged_at`, `head.ref`, `draft`, `updated_at` where `gh pr list --json` returned camelCase fields and derived ones (`statusCheckRollup`, `reviewDecision` for `--rich`). Which `--rich` fields have no REST source on the list endpoint, and does the scan need a per-PR call for them? → The REST list endpoint carries none of `checks`, `mergeable`, `review` or `failing_checks`, and a per-PR call for each open PR would add about 20 REST calls per scan at the 60 s beat, over 1,200 an hour. So the plain `pr-list` arm, `pr-merged`, `--since` and `--state merged` move to REST, and the `--rich` arm keeps its GraphQL call for those four fields. When GraphQL refuses, `--rich` answers the REST base fields and reports the four rich fields as unread (`checks: "unknown"`, `mergeable: "unknown"`, `review: ""`, `failing_checks: []`), never as passed: absent is not false. A test covers that fallback.
- [x] `--since` over REST: the `pulls` endpoint has no `since` parameter, so the filter runs client-side over `updated_at`. Does it stop paging early (`sort=updated&direction=desc`) to keep the request count at today's level? → Yes. The REST read asks `sort=updated&direction=desc` and stops paging at the first row whose `updated_at` is older than the watermark, so a delta costs one page in the common case, as today.
- [x] Does the slice split in two (PR reads; issue reads and `default-branch`)? One slice is simplest. A split is justified only if the `pr-list` mapping alone is large. → One slice. The `--rich` arm keeps GraphQL (answer above), so the `pr-list` change is the base-field mapping plus the fallback, which stays within one reviewable diff.

## Done when

| Claim | Check | Slice |
|---|---|---|
| No op fails while GraphQL refuses | a stub `gh` that fails `gh api graphql` and every GraphQL-backed subcommand (`pr list`, `issue view`, `issue list`, `repo view`); all five ops still answer, and `pr-list --rich` answers its base fields with the four rich fields unread | REST reads |
| `default-branch` falls back to `origin/HEAD` when the host call fails, and asks the host first when it answers | a stub `gh` whose `GET repos/{owner}/{repo}` fails, then one that answers a branch other than `origin/HEAD` | REST reads |
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

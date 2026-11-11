# Review and merge stop on the GraphQL secondary limit; their GitHub calls move to REST

> The GitHub arms of `pr-review`, `pr-state`, `pr-merge` and `commit-status` call GraphQL-backed `gh` subcommands, so one GraphQL secondary-limit refusal stops `plot-review.mjs` and `plot-ask.mjs merge` while REST quota remains.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** ship-2-32-0
- **Issue:** #3265
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3268 merged
- **Started:** 2026-11-08, Jan Wloka, `bug/github-arms-use-rest`
- **Delivered:** 2026-11-08
- **Released:** 2026-11-11, v2.32.0

## Changelog

- `plot-review.mjs` and `plot-ask.mjs merge` complete on GitHub while the GraphQL secondary rate limit is active, because their `plot-host.sh` ops read and merge through REST.

Board impact: none. The JSON each op prints stays the same, so the board and every caller are unchanged.

## Motivation

On 2026-11-08 the GraphQL secondary limit stopped reviews three times. At 15:20 UTC `gh api rate_limit` read GraphQL 4456/5000 and core 4797/5000, `gh api graphql` answered `RATE_LIMIT ... already exceeded`, and `plot-review.mjs` refused PRs #3254, #3255 and #3256 with `the host did not answer the review status of PR #N`. The REST bucket and the primary GraphQL bucket both had quota left.

`readTrusted` in `packages/board/src/server/entry/review.ts:310` returns null when `prReview` fails, so one GraphQL refusal ends the whole review run.

## Design

### Approach

These GitHub arms in `skills/plot/scripts/plot-host.sh` call `gh` subcommands that use GraphQL (line numbers as measured on 2026-11-08):

| Op | Call | Line |
|---|---|---|
| `pr-review` | `gh pr view <n> --json headRefOid,comments` | 4384 |
| `pr-state` | `gh pr view <ref> --json number,state,…,mergedAt` | 4073 |
| `pr-merge` | `gh repo view --json nameWithOwner`, then `gh pr merge --match-head-commit` | 4428, 4431 |
| `commit-status` | `gh repo view --json nameWithOwner` | 6044 |

Each arm moves to REST on GitHub:

- `pr-review`: `GET /repos/{owner}/{repo}/pulls/{n}` for the head SHA and `GET /repos/{owner}/{repo}/issues/{n}/comments` for the comments.
- `pr-state`: `GET /repos/{owner}/{repo}/pulls/{n}` (or `pulls?head=` for a branch ref), plus `commits/{sha}/check-runs` and `commits/{sha}/status` for the check rollup.
- `pr-merge`: `PUT /repos/{owner}/{repo}/pulls/{n}/merge` with `sha` as the head pin. The API refuses a moved head with 409, which keeps the `head-moved` refusal.
- `nameWithOwner`: read from the `origin` remote URL, with no host call.

The JSON each op prints stays the same, so no caller changes. The Bitbucket arms do not change. `scripts/check-host-cli-callers.sh` keeps passing.

### Open Questions

- [x] `pr-state` prints `mergeable`, `mergeStateStatus` and `mergeCommit`. Does the REST pull object carry an equivalent for each, or does one need a second call? → One call. `GET /pulls/{n}` carries `mergeable` (boolean or null), `mergeable_state` (lowercase: `clean`, `dirty`, `blocked`, `behind`, `unstable`, `has_hooks`, `unknown`, `draft`) and `merge_commit_sha`. The arm maps `mergeable` to `MERGEABLE`/`CONFLICTING`/`UNKNOWN`, upper-cases `mergeable_state`, and prints `mergeCommit` as `{"oid": <merge_commit_sha>}` only when the PR is merged, so the printed JSON keeps the GraphQL shape.
- [x] The merger-app token path (`plot-merger-token.mjs`) sets `GH_TOKEN` for `gh pr merge`. Confirm `gh api -X PUT` honours it the same way. → Yes. `gh api` reads `GH_TOKEN` exactly as `gh pr merge` does, so the arm keeps `GH_TOKEN="$merger_token" gh api -X PUT …`. A test asserts the stub sees the merger token on the PUT.
- [x] Does the `--delete-branch` flag of `pr-merge` need a separate `DELETE /git/refs/heads/{branch}` call, and does that call keep the current failure behaviour? → Yes, a separate call after a successful merge. A failed delete prints one warning line and leaves the merge's exit 0, as `gh pr merge --delete-branch` does today: the merge is the action, the ref is cleanup.

## Slices

### REST arms

- `bug/github-arms-use-rest` — move the four GitHub arms to REST and derive `nameWithOwner` from the `origin` URL. A test stubs `gh` so every GraphQL call fails, and `plot-review.mjs <pr>` and `plot-ask.mjs merge <pr> <sha>` complete. <!-- builds: a REST-only GitHub path for pr-review, pr-state and pr-merge in plot-host.sh --> → #3271

## Notes

- Source: tracker issue #3265, https://github.com/plot-pm/plot/issues/3265.
- Deliverable search for the REST arms found no existing REST implementation of these ops.

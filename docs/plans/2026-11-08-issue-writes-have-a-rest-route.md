# Issue writes have a REST route

> `plot-host.sh issue-comment` and `issue-label` read and write over REST only, as #3271 made `pr-review`, `pr-merge`, `commit-status` and `pr-state` do, so a delivery's tracker update reaches its issue while GitHub's GraphQL limit is spent.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** ship-2-32-0
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-09, Jan Wloka, plan-PR #3272 merged
- **Started:** 2026-11-09, Jan Wloka, `bug/issue-writes-have-a-rest-route`

## Changelog

- A plan's phase now reaches its GitHub issue (the plan-link comment and the `plan:<phase>` label) while GitHub's GraphQL limit is spent: `plot-host.sh` writes both over REST.

Board impact: none. The board reads no issue comment or label this plan changes.

## Motivation

On 2026-11-08 four deliveries in a row reported `plan-state: 3170 failed plot-host: GraphQL: API rate limit already exceeded` and `tracker=failed`, and two retries of `plot-plan-state.sh --phase delivered` an hour later failed the same way. During those hours the REST `core` budget held 4700 or more requests. GitHub's secondary limit refuses GraphQL calls while `gh api rate_limit` still reports GraphQL points left (`graphql_budget_spent` cannot see it, `plot-host.sh:2462-2480`), so the budget gate does not move the call.

The tracker update is a copy of Plot's state and never blocks a delivery, but every refused write leaves the issue showing an older phase until a person reruns it, and nothing reruns it on its own.

The two ops are GraphQL-dependent only in part:

| Op | Today | GraphQL step |
|---|---|---|
| `issue-comment` (`plot-host.sh:5748`) | finds the marked comment through `gh_marker_comment_id` (REST, `:697`), edits it through `gh api -X PATCH` (REST, `:702`) | a first comment goes through `gh issue comment` |
| `issue-label` (`plot-host.sh:5746`) | reads labels with `gh issue view --json labels`, creates the label with `gh label create`, sets it with `gh issue edit` | all three |

#3271 (`bug/github-arms-use-rest`, merged 2026-11-08) moved four GitHub arms of `plot-host.sh` to REST: `pr-review` reads `repos/{owner}/{repo}/pulls/<n>` through `gh_api_harvest`, `pr-merge` and `commit-status` name the repository through `gh_origin_slug` (`plot-host.sh:2560`, read from the git remote with no API call) instead of `gh repo view`, and `pr-state` reads checks and mergeability over REST. It left `issue-comment` and `issue-label` on GraphQL. This plan moves those two the same way.

## Design

### Approach

- **REST only, as #3271 did.** No route switch and no fallback: both ops call REST every time, so there is one path to test.
- **`issue-comment`:** the marked comment's lookup and edit stay as they are (REST already). A first comment is `POST repos/{owner}/{repo}/issues/<n>/comments` through `gh api` instead of `gh issue comment`.
- **`issue-label`:** `GET repos/{owner}/{repo}/issues/<n>/labels` for the carried labels; `POST repos/{owner}/{repo}/labels` to create the label, where `422 already_exists` counts as present; `POST …/issues/<n>/labels` to add it; `DELETE …/issues/<n>/labels/<name>` for each label the call removes. The colour and description stay the ones the GraphQL route writes.
- **Repository name:** where a call needs `owner/repo` outside `gh api`'s placeholder, it uses `gh_origin_slug`, as #3271 does.
- **Same answer as before.** The comment body and the label set after a write are identical to what the GraphQL route left. No caller changes: `tracker-plan-state.ts` keeps calling `issue-comment`, `issue-comment-read` and `issue-label` as it does.
- **Bash 3.2**, and the shell-line ratchet: added lines are paid for by removing an equal number of shipped shell lines (`scripts/check-shell-lines.sh pr`), as #3271's `plot-host: pay the shell lines the REST arms add` did.
- **Bitbucket and Jira are unchanged.** Both ops already refuse anything but a GitHub issue source.

### Open Questions

- [ ] `gh_route` (`plot-host.sh:2483`) still answers `graphql` for every op but `pr-state`. Does #3271 leave it in use, and should these two ops name `rest` there for the budget record, or is the route table now dead code? Read it when implementing; do not extend a table nothing consults.

## Done when

| Claim | Check | Slice |
|---|---|---|
| A first plan-link comment posts through REST | stub `gh` records `api … POST …/issues/<n>/comments` and no `issue comment` | REST route |
| A label write creates the label once, adds it and deletes the removed labels over REST | stub `gh` records only `gh api` calls; the label is created once, added, and the removed labels are deleted | REST route |
| Neither op starts a GraphQL call | a stub `gh` that fails every `graphql` and every `gh issue`/`gh label` subcommand; both ops still succeed | REST route |
| The written comment and labels match what the GraphQL route left | the existing `host.test.mjs` issue rows, with their stubs moved to the REST calls | REST route |
| The shipped shell does not grow | `scripts/check-shell-lines.sh pr` | REST route |

## Slices

### REST route

- `bug/issue-writes-have-a-rest-route` — REST bodies for `issue-comment` and `issue-label` in `skills/plot/scripts/plot-host.sh`, contract rows in `test/reconcile/host.test.mjs`; a changeset for `plot` <!-- builds: REST routes for plot-host.sh issue-comment and issue-label --> → #3309

## Notes

- Found while delivering sprint `nothing-runs` on 2026-11-08: the four deliveries pushed cleanly, and each tracker update to #3170 failed on the GraphQL limit while REST had budget.
- Definition of Done: docs/definition-of-done.md.

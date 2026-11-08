# Issue writes have a REST route

> `plot-host.sh issue-comment` and `issue-label` fall back to REST when GraphQL is refused for rate, as `pr-state` already does, so a delivery's tracker update reaches its issue while the GraphQL budget is spent.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** pr
- **Impl:** own branches

## Changelog

- A plan's phase now reaches its GitHub issue (the plan-link comment and the `plan:<phase>` label) while GitHub's GraphQL limit is spent: `plot-host.sh` writes both through REST when GraphQL is refused for rate, or when `PLOT_HOST_FORCE_REST=1` is set.

Board impact: none. The board reads no issue comment or label this plan changes.

## Motivation

On 2026-11-08 four deliveries in a row reported `plan-state: 3170 failed plot-host: GraphQL: API rate limit already exceeded` and `tracker=failed`, and two retries of `plot-plan-state.sh --phase delivered` an hour later failed the same way. During those hours the REST `core` budget held 4700 or more requests. GitHub's secondary limit refuses GraphQL calls while `gh api rate_limit` still reports GraphQL points left (`graphql_budget_spent` cannot see it, `plot-host.sh:2462-2480`), so the budget gate does not move the call.

The tracker update is a copy of Plot's state and never blocks a delivery, but every refused write leaves the issue showing an older phase until a person reruns it, and nothing reruns it on its own.

The two ops are GraphQL-dependent only in part:

| Op | Today | GraphQL step |
|---|---|---|
| `issue-comment` (`plot-host.sh:5748`) | finds the marked comment through `gh_marker_comment_id` (REST, `:697`), edits it through `gh api -X PATCH` (REST, `:702`) | a first comment goes through `gh issue comment` |
| `issue-label` (`plot-host.sh:5746`) | reads labels with `gh issue view --json labels`, creates the label with `gh label create`, sets it with `gh issue edit` | all three |

`pr-state` already has the shape this plan copies: `gh_route` (`plot-host.sh:2483`) answers `rest` when `PLOT_HOST_FORCE_REST=1` or the GraphQL budget reads spent, and a GraphQL call refused for rate re-enters the op once with `PLOT_HOST_FORCE_REST=1` (`plot-host.sh:4070-4078`). `gh_route`'s own comment says an op that grows a REST fallback gets an arm (`plot-host.sh:2497-2499`).

## Design

### Approach

- **Route.** `gh_route` gets an arm for `issue-comment` and `issue-label`, the same as `pr-state`: `rest` when `PLOT_HOST_FORCE_REST=1` or `graphql_budget_spent`, else `graphql`.
- **REST bodies**, behind that route:
  - `issue-comment`: the marked comment's lookup and edit stay as they are (REST already); a first comment is `POST repos/{owner}/{repo}/issues/<n>/comments` instead of `gh issue comment`.
  - `issue-label`: `GET repos/{owner}/{repo}/issues/<n>/labels` for the carried labels; `POST repos/{owner}/{repo}/labels` to create the label, where `422 already_exists` counts as present; `POST …/issues/<n>/labels` to add it; `DELETE …/issues/<n>/labels/<name>` for each label the call removes. The label colour and description are the ones the GraphQL route writes.
- **Rate re-entry.** Where the GraphQL route is taken and refused for rate (`is_rate_refusal`), the op re-enters itself once with `PLOT_HOST_FORCE_REST=1`, as `pr-state` does. A REST refusal then fails the op as today; there is no third path.
- **Same answer on both routes.** The comment body and the label set after a write are identical whichever route wrote them. No caller changes: `tracker-plan-state.ts` keeps calling `issue-comment`, `issue-comment-read` and `issue-label` as it does.
- **Bash 3.2**, and the shell-line ratchet: the new arms must be paid for by removing an equal number of shipped shell lines elsewhere (`scripts/check-shell-lines.sh pr`).
- **Bitbucket and Jira are unchanged.** `issue-comment` and `issue-label` already refuse anything but a GitHub issue source (`plot-host.sh:5744-5745`).

### Open Questions

- [ ] Does `gh api` resolve the `{owner}/{repo}` placeholder from the git remote with no API call? On 2026-11-08 `pr-merge` failed with `gh repo view could not resolve owner/repo from the current checkout` while GraphQL was throttled, because `gh repo view` is itself a GraphQL call. If the placeholder needs a GraphQL lookup too, the REST route must name the repository from `git remote get-url origin` instead.
- [ ] Should `pr-merge` get the same treatment? Its `gh repo view` lookup failed under the same limit on 2026-11-08. It is out of this plan's scope unless the answer above makes it the same fix.

## Done when

| Claim | Check | Slice |
|---|---|---|
| `gh_route` answers `rest` for both ops when forced or when the budget reads spent | contract rows in `test/reconcile/host.test.mjs` with a stub `gh` | REST route |
| A first plan-link comment posts through REST | stub `gh` records `api … POST …/issues/<n>/comments` and no `issue comment` | REST route |
| A label write starts no GraphQL call on the REST route | stub `gh` records only `gh api` calls; the label is created once, added, and the removed labels are deleted | REST route |
| A GraphQL call refused for rate re-enters once over REST and succeeds | a stub `gh` that answers the GraphQL step with the rate-limit message and the REST steps normally | REST route |
| Both routes leave the same comment body and label set | one fixture issue written once per route, compared | REST route |
| The shipped shell does not grow | `scripts/check-shell-lines.sh pr` | REST route |

## Slices

### REST route

- `bug/issue-writes-have-a-rest-route` — `gh_route` arms and the REST bodies for `issue-comment` and `issue-label` in `skills/plot/scripts/plot-host.sh`, the rate re-entry, contract rows in `test/reconcile/host.test.mjs`; a changeset for `plot` <!-- builds: REST routes for plot-host.sh issue-comment and issue-label -->

## Notes

- Found while delivering sprint `nothing-runs` on 2026-11-08: the four deliveries pushed cleanly, and each tracker update to #3170 failed on the GraphQL limit while REST had budget.
- Definition of Done: docs/definition-of-done.md.

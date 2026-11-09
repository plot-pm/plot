## Implementation brief — issue-writes-have-a-rest-route

- **Plan (canonical):** `docs/plans/2026-11-08-issue-writes-have-a-rest-route.md` on `main`
- **Approved:** 2026-11-09, Jan Wloka, plan-PR #3272 merged
- **Branch:** `bug/issue-writes-have-a-rest-route` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

On 2026-11-08 four deliveries printed `plan-state: 3170 failed plot-host: GraphQL: API rate limit already exceeded` and `tracker=failed`, while the REST `core` budget held 4700 or more requests. Two retries an hour later failed the same way. `plot-host.sh issue-label` and the first-comment path of `issue-comment` still call GraphQL-backed `gh` subcommands (`gh issue view`, `gh label create`, `gh issue edit`, `gh issue comment`). Move both to `gh api` REST calls, as #3271 did for `pr-review`, `pr-merge`, `commit-status` and `pr-state`.

Both ops live in the `issue-label|issue-comment|issue-comment-read|issue-close` arm of `skills/plot/scripts/plot-host.sh` (about line 5740 on `origin/main`). Find them by name, since the line numbers move.

- **`issue-comment`:** the marker lookup (`gh_marker_comment_id`) and the edit (`gh api -X PATCH`) are REST already. Only `gh_edit_or_post_comment`'s `else` branch, `gh "$2" comment "$3" --body`, is not. Make it `gh api -X POST "repos/{owner}/{repo}/issues/$3/comments" -f body="$4"`. Check the helper's other callers (grep `gh_edit_or_post_comment`: the PR-comment path passes `pr` as `$2`) before changing its shape, and keep the PR path working.
- **`issue-label`:** `gh api repos/{owner}/{repo}/issues/<n>/labels` for the carried labels; `POST repos/{owner}/{repo}/labels` to create the label with colour `ededed` and description `Plot plan phase: <phase>`, where a 422 `already_exists` counts as present; `POST …/issues/<n>/labels` to add it; `DELETE …/issues/<n>/labels/<name>` for each label the call removes, URL-encoded (`plan:released` carries a colon). The remove set is still the intersection of the caller's list with the labels the issue carries.

### Decisions the plan settles — do not re-derive them

**REST only, no route switch and no fallback.** A fallback keeps a GraphQL path alive that no test would reach once the REST path works, and the secondary limit makes `graphql_budget_spent` blind to the failure (`gh api rate_limit` still reports points left while GraphQL calls are refused). So the budget gate cannot choose the route, and both ops call REST every time. #3271 took the same decision.

**The plan's open question is answered by reading `gh_route`.** On `origin/main`, `gh_route` has an arm for `rate-limit|limit` (rest) and for `pr-state` (rest or graphql by budget); every other op falls to the default `graphql` arm. The only reader of `$route` is the `pr-state` arm (`if [ "$route" = "rest" ]`). These two ops therefore never consult `$route`, so do not add them to `gh_route`: that would extend a table nothing reads, which the plan forbids. Re-check with `grep -n '\$route' skills/plot/scripts/plot-host.sh` before you rely on this, and record the answer in the plan's Open Questions (tick it) in the same PR.

**Repository name.** Where a call needs `owner/repo` outside `gh api`'s `{owner}/{repo}` placeholder, use `gh_origin_slug` (reads the git remote, no API call). Do not call `gh repo view`: that is GraphQL, and #3271 removed it from `pr-merge` and `commit-status` for that reason.

**Same answer as before.** The comment body, the label colour and description, and the label set after the write match the GraphQL route's. `tracker-plan-state.ts` keeps calling `issue-comment`, `issue-comment-read` and `issue-label` with the same arguments; no domain code changes.

**Carried-over invariants.** Absent is not false: a missing label list on the issue means no label to remove, not a failure. Read the exit code, not the emptiness: a `gh api` failure on the label GET refuses through `gh_fail`; it must not read as "carries no labels" and then add a second `plan:*` label (that is the #2054/#2055 failure, where an issue ended up with two phase labels). Bash 3.2 only.

### Done when

The plan's `## Done when` table is the specification. These assertions exist because a naive implementation passes without them:

- **A stub `gh` that fails every `graphql` call and every `gh issue` and `gh label` subcommand, with `gh api` answering.** Both ops must still exit 0. This catches a leftover `gh issue comment` or `gh label create` on a branch the happy-path test does not reach.
- **A stub where `POST …/labels` answers 422 `already_exists`.** The op must still add the label and exit 0. This catches a create step that treats the existing label as a failure.
- **A stub where the label GET fails.** The op must exit non-zero and add nothing. This catches an empty-answer read that adds a second phase label.
- **A removed label with a colon in its name.** The DELETE URL must carry it encoded, and the stub must record the encoded form.

Move the stubs of the tests that exercise these ops to the REST calls: `test/reconcile/host.test.mjs` (the `issue-comment` rows from about line 11013; there are no `issue-label` rows yet, so add them), `test/reconcile/release-tells-the-tracker.test.mjs` and `test/reconcile/reconcile-released-labels.test.mjs`. Their stubs implement `gh issue edit` and `gh label create` today and fail once the script stops calling them. Run `git grep -ln "gh issue edit\|label create\|issue comment" -- test` to find any other.

Plus: a changeset for `plot` (description first, `bumps:` block last), `./scripts/check-changeset-packages.sh`, and `./scripts/check-bash32-syntax.sh`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI and a failure there comes back as a correction. List no full suite.

**Shell gate.** `scripts/check-shell-lines.sh pr` refuses a pull request whose shipped shell under `skills/` is longer than at its merge base. This slice edits `plot-host.sh`, so every added line is paid for in the same change by removing an equal number of shipped shell lines elsewhere, as #3271's `plot-host: pay the shell lines the REST arms add` did. The gate counts commands, not lines: joining statements with `;` or `&&`, or folding `fi` or `done` onto the previous line, is not a payment. The gate stores no number and has no override. A compact REST body (one `gh api` helper for the label calls) costs fewer lines than three inline calls, so write the helper first.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line under `## Slices` in the plan.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh`, the three test files named above, one changeset, and the plan's Open Questions line. It touches no `packages/` code, no Bitbucket or Jira arm, and no `issue-close` or `issue-comment-read` (REST or out of scope). No other slice of this plan exists. For other branches in flight on `plot-host.sh`, run `/plot-pulse` before pushing and rebase over any that merge first.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

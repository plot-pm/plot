## Implementation brief — review-and-merge-stop-on-the (wave 1: REST arms)

- **Plan (canonical):** `docs/plans/2026-11-08-review-and-merge-stop-on-the.md` on `main`
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3268 merged
- **Branch:** `bug/github-arms-use-rest` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the plan's only wave. Nothing waits on it and it waits on nothing. Tracker issue: #3265.

### What to build

On 2026-11-08 at 15:20 UTC the GraphQL secondary limit refused `plot-review.mjs` for PRs #3254, #3255 and #3256 with `the host did not answer the review status of PR #N`, while `gh api rate_limit` read GraphQL 4456/5000 and core 4797/5000. `readTrusted` (`packages/board/src/server/entry/review.ts:310`) returns null when `prReview` fails, so one refusal ends the run. `plot-ask.mjs merge` has the same exposure through `pr-merge`.

Four GitHub arms in `skills/plot/scripts/plot-host.sh` call `gh` subcommands that spend GraphQL. Move each to REST (`gh api`) and print the same JSON as today, so no caller changes:

| Op | GraphQL call today | REST replacement |
|---|---|---|
| `pr-review` | `gh pr view <n> --json headRefOid,comments` | `GET pulls/{n}` for the head SHA, `GET issues/{n}/comments` for the comments |
| `pr-state` | `gh pr view <ref> --json …` | `GET pulls/{n}` (or `pulls?head=owner:branch&state=all`), plus `commits/{sha}/check-runs` and `commits/{sha}/status` |
| `pr-merge` | `gh repo view --json nameWithOwner`, then `gh pr merge --match-head-commit` | `PUT pulls/{n}/merge` with `sha` as the head pin |
| `commit-status` | `gh repo view --json nameWithOwner` | `nameWithOwner` from the `origin` URL, no host call |

Line numbers move; find the arms by op name (`pr-review)`, `pr-state)`, `pr-merge)`, `commit-status)`). Bitbucket arms do not change.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**`pr-state` already has a REST route; the plan's Notes line "no existing REST implementation" is wrong for this op.** `gh_route` chooses `rest` when `PLOT_HOST_FORCE_REST=1` or `graphql_budget_spent`; `rest_pr_to_state` maps the REST pull object to the GraphQL shape; and the GraphQL arm re-enters itself with `PLOT_HOST_FORCE_REST=1` when `is_rate_refusal` matches. Two gaps remain, and they are this branch's `pr-state` work: (1) `rest_pr_to_state` prints `checks: "unknown"` and no `ciChecks`, `checksSha` or `mergeStateStatus`, so a REST answer is thinner than the GraphQL one — the check rollup comes from the two calls named in the plan; (2) the re-entry fires only if `is_rate_refusal` matches the text `gh` prints for the secondary limit. That pattern is `rate limit|secondary rate|abuse detection|403.*forbidden`, case-insensitive. Reproduce the 2026-11-08 message (`RATE_LIMIT ... already exceeded`) against it before trusting it. Whether `pr-state` should go REST-first for GitHub or keep the retry is yours to settle from that reproduction; the plan's requirement is only that the printed JSON is unchanged and a refused GraphQL call does not end `plot-review.mjs` or `plot-ask.mjs merge`.

**One call carries `mergeable`, `mergeable_state` and `merge_commit_sha`** (plan Open Question 1, answered). Map `mergeable` to `MERGEABLE`/`CONFLICTING`/`UNKNOWN`, upper-case `mergeable_state` into `mergeStateStatus`, and print `mergeCommit` as `{"oid": <merge_commit_sha>}` only when the PR is merged. A second call for any of these is the wrong shape. `plot-fleet-scan.sh` reads `"state":"[A-Z]*"` with a regex over the JSON text, so a lowercase REST value reads as no answer at all, not a wrong one.

**`pr-merge` keeps the merger token.** `gh api -X PUT` reads `GH_TOKEN` as `gh pr merge` does, so the arm keeps `GH_TOKEN="$merger_token" gh api -X PUT …` (plan Open Question 2). A test asserts the stub sees the merger token on the PUT. The token goes into `GH_TOKEN` only — never argv, a file or a log line.

**The head pin is the PUT's `sha`.** GitHub answers 409 for a moved head; map it to the existing `head-moved` refusal text, which `plot-ask.mjs merge` and the controller gate read by name. A 405 (not mergeable) and a 409 are different answers; do not fold them.

**`--delete-branch` is a separate `DELETE git/refs/heads/{branch}` after a successful merge** (plan Open Question 3). A failed delete prints one warning line and the op still exits 0: the merge is the action, the ref is cleanup, as with `gh pr merge --delete-branch` today.

**`nameWithOwner` comes from the `origin` URL.** `gh repo view` is GraphQL-free but still a call that can fail, and `plot-commit-status.mjs --repo` already has a sentinel (`GH_REPO_VIEW_FAILED`) for its failure. Look for an existing origin-URL parser before writing one — `plot-bitbucket-slug.mjs` does this for Bitbucket and shows the traps (a port after the host of a `ssh://` URL; the colon of an scp-style remote). An origin that parses to nothing keeps the current refusal, not a guessed slug.

**New REST calls go through `gh_api_harvest`** where the arm needs the budget record to stay honest, as `pr-state`'s REST route does. A bare `gh api` spends REST and files nothing.

Rules carried over, unchanged:

- **Absent is not false.** A failed call is not `NONE`, not `absent`, and not an empty comment list. Read the exit code, not the emptiness. `pr-review` prints `state: "absent"` only when the statuses list answered and held no `plot/review` row.
- **Pages and PRs travel through stdin to `jq`, never `--argjson`.** Linux caps argv at 128 KB per argument; macOS does not, so the failure shows only on CI. Comments need `--paginate`.
- **`plot-host.sh` stays the one place that calls `gh`** (`scripts/check-host-cli-callers.sh`).
- **The `pr-review` JSON keeps `bypass`.** It is true when any comment body starts with `review-bypass:`. REST comment objects carry `.body`, so the filter is the same, but a first page alone misses later comments.

### Done when

The plan has no `## Done when` section; its slice line is the specification: *a test stubs `gh` so every GraphQL call fails, and `plot-review.mjs <pr>` and `plot-ask.mjs merge <pr> <sha>` complete.* The assertions that exist because a naive implementation passes without them:

- **The stub fails GraphQL by name.** Make the `gh` stub exit non-zero with the secondary-limit text on `gh pr view`, `gh pr merge`, `gh repo view` and `gh api graphql`, and answer `gh api repos/…` normally. A stub that fails everything proves nothing about REST; a stub that fails nothing proves nothing about GraphQL.
- **Output parity.** For each of `pr-review`, `pr-state` (number and branch ref) and `pr-merge`, the REST arm and the old GraphQL arm print the same JSON keys for the same PR fixture. Without a parity assertion a REST arm that drops `ciChecks` or `mergeStateStatus` passes the stub test and breaks the board silently.
- **`pr-state` merged PR.** `state` reads `MERGED` for a REST `closed` PR with `merged_at` set, and `mergeCommit` is `{"oid": …}` only then. This catches the REST trap `rest_pr_to_state` already documents.
- **`pr-merge` pin.** A moved head (409) prints the `head-moved` refusal and merges nothing; a matching head merges. The merger token is the `GH_TOKEN` on the PUT, and absent a declared Merger app the signed-in identity runs it (`plot-merger-token.mjs` exit 5).
- **`pr-merge --delete-branch` failure** leaves exit 0 with one warning line.
- **No GraphQL spend.** After the change, none of the four arms invokes `gh pr view`, `gh pr merge`, `gh repo view` or `gh api graphql` on GitHub. A grep-level assertion in the test is enough.

Plus the repo's gates. Before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. The existing tests nearest this change are `test/reconcile/host-pr-review.test.mjs`, `host-commit-status.test.mjs`, `host.test.mjs` and `host-cli-gate.test.mjs`. `host.test.mjs` cannot finish under load: run the test names you touched, not the whole file.

**Shell gate.** `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This branch edits `plot-host.sh`, so growth is paid for in the same change — remove shell elsewhere, or write a rule in the domain and ask it through a bundle. The gate counts commands, not lines: joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. It stores no number and has no override. The REST mappers are the likely growth; measure with `scripts/check-shell-lines.sh --per-file` before you design them, and decide early whether a `jq` mapper shared by the four arms or a bundle is cheaper than four inline ones.

No changeset text is dictated here; write one for `plot` naming the change as the plan's `## Changelog` line does, description first and the `bumps:` block last.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh`, its tests under `test/reconcile/`, and a changeset. It does not touch `packages/board/src/server/entry/review.ts` (the null-on-failure behaviour stays; the fix is that the call stops failing), the Bitbucket arms, `plot-commit-status.mjs` beyond the `--repo` value it is handed, or the rate-budget gate. Other branches in flight on `plot-host.sh` were not verified at dispatch — run `git log origin/main -5 -- skills/plot/scripts/plot-host.sh` before you start, and rebase if a sibling landed there.

If you find something the plan did not anticipate — in particular, an `is_rate_refusal` pattern that misses the real message — report it rather than improvising outside scope.

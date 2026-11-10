## Implementation brief — pr-and-issue-reads-still-use

- **Plan (canonical):** `docs/plans/2026-11-09-pr-and-issue-reads-still-use.md` on `main`
- **Approved:** 2026-11-09, Jan Wloka, plan-PR #3318 merged
- **Branch:** `bug/pr-and-issue-reads-still-use` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One slice, one wave. Nothing waits on it and it waits on nothing. Sprint `ship-2-32-0`.

### What to build

Five read ops in `skills/plot/scripts/plot-host.sh` still call GraphQL-backed `gh` subcommands, so they fail while GitHub's secondary GraphQL limit is active although the REST quota is nearly full. Measured 2026-11-09 (issue #3317): the approve controller refused seven times with `the host could not list its open PRs to find the one that changes the plan`, once with `spike-unmerged … (the host could not say)` because `pr-merged` answered `unknown`; the idea controller refused #3265, #3274, #3293 and #3306 with `issue-unreadable … GraphQL: API rate limit already exceeded`; the fleet reading showed `cannot read the PR — the host could not be asked`.

Move the GitHub arm of each op to `gh api` REST, as #3271 did for `pr-state` and `issue-writes-have-a-rest-route` did for `issue-label` and `issue-comment`. The Bitbucket arms do not change. Current call sites on `main` (the plan's line numbers are from `ca37e53ba` and have drifted):

| Op | Call today | Where |
|---|---|---|
| `pr-list` | `pr_list_call gh … pr list` ×3 (Jenkins rich, plain rich, plain) | `:4735`, `:4780`, `:4811` |
| `pr-merged` | `gh pr list --head … --json mergedAt` | `:4212` |
| `pr-merge-commit` | `gh pr list --head … --json number,mergedAt,mergeCommit,baseRefName`, in a doubling-limit loop | `:4283` |
| `pr-merged-heads` | `gh pr list --head … --json mergedAt,headRefOid` | `:4338` |
| `issue-list` | `gh issue list` | `:5469` |
| `issue-view` | `gh issue view` | `:5593` |
| `default-branch` | `gh repo view --json defaultBranchRef` | `:3981` |

The plan's table names `:4212`, `:4286`, `:4338` as the `pr-merged` family: that is three ops, not one. All three move, or `pr-merged` answers while `pr-merge-commit` still refuses in the same pass.

Reuse what #3271 left: `gh_rest_repo` (`:2536`, honours `-R`/`--repo`), `gh_origin_slug` (`:2557`), and `gh_api_harvest` (`:3719`), which records the REST bucket from the response headers. `makeStubsRateAware` (`test/reconcile/host.test.mjs:291`) already stubs a REST-vs-GraphQL budget; extend it rather than writing a second stub. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**`pr-list --rich` keeps its GraphQL call.** The REST list endpoint carries none of `checks`, `mergeable`, `review` or `failing_checks`, and a per-PR call for each open PR adds about 20 REST calls per scan at the 60 s beat, over 1,200 an hour. Per-PR calls were rejected on that number. When GraphQL refuses, `--rich` answers the REST base fields with `checks: "unknown"`, `mergeable: "unknown"`, `review: ""`, `failing_checks: []`. **Absent is not false:** a fallback row must never read `passed`, `MERGEABLE` or `APPROVED`. This is the rule CLAUDE.md keeps re-learning, and the test for it is a Done-when row.

**`pr-list --since` runs client-side over `updated_at`.** The `pulls` endpoint has no `since`. Ask `sort=updated&direction=desc` and stop paging at the first row older than the watermark, so a delta costs one page. Send the caller's watermark through verbatim; do not re-render it (the `--since` comment in `plot-host.sh` records how re-rendering closes a window forever). The whole-page notice keeps the shape `plot-fleet-scan.sh` reads today (`pr_list_report_truncation`, `PR_LIST_PARTIAL_RC` 7 for a partial answer); a partial answer exits non-zero, never 0.

**`pr-merged` answers `mergedAt`, never `state`.** A merged PR reports `CLOSED` on `gh pr list`; on REST it is `merged_at`. Read `merged_at` (and `merge_commit_sha` for `pr-merge-commit`). REST `merge_commit_sha` on an OPEN PR is a test-merge sha, so read it only where `merged_at` is non-null — the same guard `rest_pr_state` already carries. Page with `per_page=100` and the same stop rule the doubling-limit loop had; a first page of exactly 100 pulls the next page.

**`issue-list` drops pull requests.** The REST `issues` endpoint returns PRs as issues, so every entry with a `pull_request` key is dropped, and `--limit N` pages until N issues remain after the drop. A page full of PRs must not shorten the answer. The `--search` qualifiers do not move to the search endpoint, which has its own 30-per-minute limit; the three filters run client-side as the plan lists: `--title-has` (case-insensitive substring, open only, as today), `--state closed` with a since date (`since=` plus a `closed_at >= date` filter), `--state changed` (`state=all&since=<ts>`, each row's status from its own `state`), `--label` (REST `labels=<name>`). A date-only `--since` becomes `YYYY-MM-DDT00:00:00Z`, because REST takes only a full ISO 8601 timestamp.

**`default-branch` asks the host first and falls back to `origin/HEAD`.** `GET repos/{owner}/{repo}` and `default_branch`; the ref only when the host call fails. The order matters: `origin/HEAD` is a clone-time cache and on 2026-09-24 a clone whose GitHub default moved to `develop` kept `origin/HEAD → main`, so the board read two of three plans from the wrong branch. The existing `[ -n "$_db" ] ||` fallback at `:3996` stays as it is. Keep the `"null"` guard.

**One output per op, unchanged.** Each op prints the JSON it prints today, so no caller changes. Field mapping: REST `head.ref` → `head`, `draft` → `draft`, `html_url` → `url`, `head.sha` → `headSha`, `merged_at` → `mergedAt` (`""` when null), `user.login` → `author`, and `state` upper-cased where a caller reads it as today (a merged PR's `state` is `MERGED` only where today's arm printed it so). Compare against the existing rows in `host.test.mjs` before choosing; do not invent a mapping.

**Rules carried over unchanged.** An empty result is not "no PR": read the exit code, not the emptiness. A list has no absent subject, so a failed list call exits non-zero and prints nothing (`gh_fail`, `pr_list_failed`); do not add an empty-list fallback. Every `pr_list_call …` site keeps `|| exit $?` (a command substitution is a subshell). Call-site budget bookkeeping moves with the call: `issue-list` records `budget_record_call github github graphql …` today, and a REST read records the `rest` bucket through `gh_api_harvest`, so the budget view does not charge GraphQL for REST.

### Done when

The plan's `## Done when` table is the specification. Assertions that exist because a naive implementation would pass without them:

- **A stub `gh` that fails `gh api graphql` AND every GraphQL-backed subcommand** (`pr list`, `issue view`, `issue list`, `repo view`). A stub that fails only `api graphql` passes against an arm that still shells to `gh pr list`. It catches a half-moved op.
- **`default-branch` with a stub whose REST answer differs from `origin/HEAD`**, then one whose REST call fails. Without the first, an arm that reads the ref first passes; without the second, the fallback is untested.
- **An `issue-list` fixture whose first page is all pull requests**, with `--limit 1` and an issue on page 2. It catches a drop-then-limit ordering bug.
- **A `pr-list --rich` fallback row asserted field by field** (`checks`, `mergeable`, `review`, `failing_checks`), not only exit code. It catches a fallback that prints `passed`.
- **A `pr-merged` fixture with `merged_at: null` and a non-null `merge_commit_sha`**, answering `not-merged`. It catches reading the sha instead of the stamp.
- **A `--since` fixture whose second page is older than the watermark**, asserting one REST page was requested.
- The approve controller approves a plan whose PR is open, and the idea controller reads an issue, both through the stubbed run (Done-when rows 3 and 4).
- Board impact: confirm the board's `pr-list` and `issue-list` reads see no changed field (plan *Board impact*). Compare the printed JSON before and after on one fixture.

Plus: a changeset for `plot` (`patch`), description first and the `bumps:` block last, then `./scripts/check-changeset-packages.sh`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally. Run the whole reconcile glob rather than only `host.test.mjs`: it changes ops the fleet-scan tests stub.

The shell gate applies. `scripts/check-shell-lines.sh pr` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-host.sh`, so every line it adds is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines: joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. It stores no number and has no override. Replacing three near-identical `pr_list_call gh … pr list` calls with one REST helper is the obvious source of the deletion. `scripts/check-host-cli-callers.sh` keeps passing: every call stays inside `plot-host.sh`. Bash 3.2: no associative arrays, no `${var,,}`, no `mapfile`.

### Bookkeeping

When the PR opens, append `→ #<number>` to the branch's line under `## Slices`. Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh`, `test/reconcile/host.test.mjs` (and a fleet-scan or controller test only where a stub must move to the REST call), and one changeset. Checked 2026-11-09 against every `bug/`, `feature/` and `infra/` branch on origin: none changes `plot-host.sh` or `host.test.mjs`. `issue-writes-have-a-rest-route` already merged (`83c626272`, `d2c41dcb6`); its `issue-comment` and `issue-label` arms are not yours, so leave them alone.

If you find something the plan did not anticipate — a sixth op that reads GraphQL, a caller that depends on a GraphQL-only field — report it rather than improvising outside scope.

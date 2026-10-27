## Implementation brief — the-spend-record-counts-a-paged

- **Plan (canonical):** `docs/plans/2026-10-27-the-spend-record-counts-a-paged.md` on `main`
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2761 merged
- **Branch:** `feature/the-spend-record-counts-a-paged` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One slice, one wave. No other branch waits on it or is waited on.

### What to build

`budget_record_call` (`skills/plot/scripts/plot-host.sh:3651`) writes `spent=1` per `gh` process. A GitHub `pr-list` pages 5 to 18 times in one process, so the record reads low. Measured 2026-10-26 in #2717: `pr-list --state all --limit 3000` made 18 GraphQL requests at 1,767 PRs and recorded one line with `spent` 1. The `account=` figure, `localSpenders` and the cadence rules all read that sum.

The change: after a paged GitHub listing returns, a shared helper records the pages past the first as ONE extra line with `spent` = pages − 1. Pages are derived from the rows: `max(1, ceil(R/100))`, so extra = `(R − 1) / 100` in integer arithmetic for R > 100, else 0. The plan is canonical for the steps; this is orientation.

1. Add `GH_PAGE_ROWS=100` next to `ISSUE_PAGE_ROWS` (`:647`). Drop the `gh` clause from `ISSUE_PAGE_ROWS`'s comment: it stays Jira's `maxResults` bound.
2. `budget_record_call` gains an optional fourth argument, the `spent` value, default `1`. It replaces the literal `1` on both `budget_append` paths (`:3665`, `:3670`). No existing caller passes it.
3. A one-line helper (for example `gh_record_pages <bucket> <rows>`) calls `budget_record_call github github <bucket> <pages-1>` only when pages − 1 > 0.
4. Call it once at the top of `pr_list_report_truncation`'s GitHub branch (`:3328`). That covers the Jenkins, rich and plain arms (`:4731`, `:4776`, `:4808`). A call with no `--limit` or 0 rows returns before the branch and records nothing extra, as intended.
5. Replace the `jq | while` loop at `:5467` in the GitHub `issue-list` arm with the helper. The sum stays the same (one line of pages − 1 instead of pages − 1 lines), so `cadenceRateOf` in `tracker-shell.ts:264-297` keeps matching the record.

### Settled decisions — do not re-derive them

- **Derived, not harvested.** `gh` prints no page count, and a harvested header describes the last response only. `GH_DEBUG=api` confirmed `ceil(R/100)` for a 250-row list (3 requests) and a 150-row `--search` delta (2). `gh api graphql --paginate` with a counter was rejected for that reason. State in the code comment that `spent` counts requests, not GraphQL points: a rich page can cost more than one point.
- **Do not reuse `ISSUE_PAGE_ROWS` for GitHub.** It is Jira's bound (`:5372-5373`); changing it for `gh` would change Jira's count. `fleet-scan.ts:119-126` `scanListingCost` prices the same 100 in TypeScript. Declare that pair as a duplicate in the code comment ("A Shell Script Asks The Domain"); no corpus test is in scope.
- **Count at the leaf.** `--rich-open` (`:4609-4650`) runs `"$0" pr-list` as two child processes; each records its own pages. The parent records nothing.
- **Bitbucket and Jira do not change.** `_bb_paged_walk` already runs one `bb … api` per page through the `bb()` wrapper; Jira records one line per request (`:3173`). Pin the Bitbucket per-page lines with a test; touch no code.
- **A failed listing records 1, and that is a floor.** The count derives from rows, and a refused page prints none. The test states "floor, not the spend". Do not try to fix it.
- **Out of scope, stays at 1:** `pr-merge-commit`'s `--head` lookup (`:4295-4300`) and `gh api --paginate` in `gh_marker_comment_id` (`:684`).
- **No reader changes.** Existing lines keep `spent` 1; the record is append-only. The line format (`b1`, ten fields) does not change.
- **Rules carried over:** absent is not false; read the exit code, not the emptiness. No destructive decision reads the record, so a higher count only slows reads.

### Done when

The plan's `## Tests` table is the specification: all cases go in `test/reconcile/host.test.mjs` through `makeStubsRateAware`, `run` and `recordOf`.

- `pr-list --limit 500` with 0, 99, 100, 101, 250, 500 rows sums `spent` to 1, 1, 1, 2, 3, 5 (`graphql`). The 100/101 boundary catches an off-by-one `ceil` versus `floor + 1`.
- `pr-list --limit 150`, 150 rows → 2.
- The same row counts through the Jenkins, rich and plain arms. A single-arm test passes while two arms stay unwired.
- `pr-list --rich-open` → pages(open) + pages(all). Catches a parent that double-counts.
- Failed `gh pr list` (non-zero exit) → 1.
- GitHub `issue-list`, 250 rows → 3 (the sum, not three lines). Catches a refactor that changes the total.
- Bitbucket `pr-list` over 3 pages → 3 `bitbucket` lines, each `spent` 1.

Every case asserts the SUM of `spent` over the run's lines for the bucket, never `.some(spent === N)`. No case spawns `plot-host.sh` without `PLOT_BUDGET_HOME` (`budgetEnvFor`, `host.test.mjs:326-329`), and none sets `PLOT_BUDGET_OFF`. Mutate before you trust: revert the helper call and confirm each row of the table goes red.

Plus: add a changeset (`plot: patch`, description first, `bumps:` block last, `plan:` line pointing at the plan; the plan's Changelog entry is the description). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI; a failure there returns as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base, with no override. Measured 2026-10-27 on a sketch, the change is +2 commands (constant 1, helper 3, call 1, loop 3 → 1). The slice removes at least 2 commands of shipped shell elsewhere in the same change, names them in the commit message, and runs `./scripts/check-shell-lines.sh pr` before pushing. A multi-line helper measured +5, so keep it one line.

### Bookkeeping

When the PR is opened, append `→ #<number>` to this branch's line under `## Slices` in the plan. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh`, `test/reconcile/host.test.mjs` and one changeset. Other `feature/*` branches in flight (checked 2026-10-27): `the-scan-listing-is-a-host-delta`, `one-pr-reader-per-machine-and`, `boards-share-one-pr-reader`, `a-merged-pending-check-is-asked-again`, `the-controller-gate-reads-a-grep`, `bundle-entries-end-through-a-drain`. The first three may touch `pr-list` paths in `plot-host.sh`; rebase and re-check the line numbers above if they merge first.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

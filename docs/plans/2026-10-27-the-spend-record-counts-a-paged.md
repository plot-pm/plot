# The spend record counts a paged listing as one request

> `budget_record_call` writes `spent=1` for every `gh` process, so a GitHub `pr-list` that pages 5 to 18 times records one request. This plan records the pages past the first through one helper shared with GitHub `issue-list`, which already counts its pages, so `account=`, `localSpenders` and the cadence rules read the real request count.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2717
- **Rounds:** 1
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- On GitHub, `plot-host.sh pr-list` records one request per page it reads in the `spent` field of `budget.tsv`, instead of one per process. `spent` counts requests, not GraphQL points. Bitbucket and Jira already record one line per request and do not change.

<!-- Board impact: none expected. The line format (`b1`, ten fields, `spent` already a number) does not change, and the board reads `budget.tsv` through the same decoder. The plan format, the template, the docs/plans layout and the helper-script table are untouched. No test pins a `pr-list` line's `spent` to 1 (`host.test.mjs:7788` asserts `.some(bucket === 'graphql')` only). -->

## Motivation

`budget_record_call` (`skills/plot/scripts/plot-host.sh:3651-3671`, line numbers at `4a1b8a5fa`) passes a literal `1` to `budget_append` on both of its paths (`:3665`, `:3670`). The `gh()` wrapper (`:3885-3892`) calls it once per `gh` process, after the process ends. The format already allows more: `packages/domain/src/entities/budget.ts` defines `spent` as "how many calls this line accounts for", and both readers sum it (`plot-budget.sh:613,628`; `packages/domain/src/rules/budget-record.ts:195`).

A paged listing is one process and several requests. `gh pr list --limit N` reads `min(N, 100)` rows per request. Measured 2026-10-27 with `GH_DEBUG=api`: 250 rows made 3 GraphQL requests, and a 150-row `--search` delta made 2. Issue #2717, measured 2026-10-26:

| Caller | Operation | Requests | Lines recorded |
|---|---|---|---|
| fleetd tick `mergedBranches` (`registryd-main.ts:791`), fallback only | `pr-list --state merged --limit 500` | about 5 GraphQL pages | 1 |
| fleet scan (`plot-fleet-scan.sh:1063`) | `pr-list --state all --limit 3000` | 18 GraphQL pages at 1,767 PRs | 1 |

The fleetd tick asks the 500-row listing only on a fallback. In steady state it asks a one-page delta (`registryd-main.ts:850-852`).

A fake `gh` reproduces the defect: 250 rows and 500 rows from `pr-list` each record one `graphql` line with `spent` 1 (ran by two jurors, panel round 1).

### The precedent

GitHub `issue-list` already counts its pages. `plot-host.sh:5465-5467` (`ce6602da9`, #1653) records one extra `budget_record_call github github graphql` line for each page past the first, derived from the row count. A fake `gh` returning 250 rows to `issue-list` writes 3 lines. No test pins that behaviour. Its page size is `ISSUE_PAGE_ROWS` (`:647`), which is also Jira's `maxResults` bound (`:5372-5373`), so a Jira change would change the GitHub count.

[`an-idle-board-and-fleetd-spend`](2026-10-26-an-idle-board-and-fleetd-spend.md) states its rates in lines and names this plan's issue as the reason. Its figure of about 610 GraphQL lines per hour is a lower bound on the requests.

## Design

### Approach

The record counts requests. The `gh()` wrapper keeps writing its `1` per process. After a paged GitHub listing returns, one shared helper records the pages past the first as one more line with `spent` = pages − 1.

1. **Derive the page count from the rows.** A GitHub listing that returns R rows made `max(1, ceil(R / 100))` requests, so the extra count is `pages − 1`, which is `(R − 1) / 100` in integer arithmetic for R > 100 and 0 otherwise. `gh` prints no page count, and a harvested header describes the last response only, so the count is derived, not harvested. The code comment states the derivation and that `spent` counts requests, not GraphQL points: a rich page (`statusCheckRollup`) can cost more than one point.
2. **One helper, shared with `issue-list`.** A new helper, for example `gh_record_pages <bucket> <rows>`, records `pages − 1` for the `github` connector when it is above 0. `budget_record_call` gains an optional fourth argument, the `spent` value, which defaults to `1`; every existing caller passes nothing. The GitHub `issue-list` arm calls the helper in place of its `jq | while` loop at `:5467`, and records one line with `spent` = pages − 1 instead of pages − 1 lines with `spent` 1. The sum stays the same, so `cadenceRateOf`, which subtracts the issue gate's `requests` (`tracker-shell.ts:264-297`), keeps matching the record.
3. **One call for the three `pr-list` arms.** The Jenkins (`:4731`), rich (`:4776`) and plain (`:4808`) arms each pass their row count to `pr_list_report_truncation github` (`:4733`, `:4778`, `:4810`). The helper call goes at the top of that function's GitHub branch (`:3328`), so one call covers all three. Only the three GitHub arms reach that branch: the other caller, `pr_list_states` (`:1605`), is called with `bitbucket` only (`:4930`, `:4962`, `:4967`). A call with no `--limit` or with 0 rows reads one page and returns before the branch, which records nothing extra, as intended.
4. **A separate GitHub page constant.** The helper divides by a new `GH_PAGE_ROWS=100`, `gh`'s page size. `ISSUE_PAGE_ROWS` stays Jira's bound, and its comment drops the `gh` clause. `scanListingCost` (`fleet-scan.ts:119-126`) prices the scan's listing with the same 100 in TypeScript; the slice declares that pair as a duplicate in the comment, per "A Shell Script Asks The Domain".
5. **Count at the leaf.** `--rich-open` (`:4609-4650`) runs `"$0" pr-list --rich --state open` and `"$0" pr-list --state all` as two child processes. Each child records its own pages. The parent records nothing for the listing.
6. **Bitbucket and Jira do not change.** `_bb_paged_walk` (`:1158-1185`) runs one `bb … api` per page, and each passes through the `bb()` wrapper (`:3895-3901`), so a walked listing already records one line per request. Jira records one line per request (`:3173`). A test pins the Bitbucket per-page lines.

### Shell-line cost

`scripts/check-shell-lines.sh` refuses growth of shipped shell against the merge base. Measured 2026-10-27 with the gate's own count on a sketch of steps 2 to 4 over `plot-host.sh` at `4a1b8a5fa`: 2,913 commands before, 2,915 after, so +2. The sketch has the constant (1), a one-line helper (3), one call in `pr_list_report_truncation` (1), and the `issue-list` loop (3) replaced by one call (1). The fourth argument changes two existing lines and adds none. A multi-line helper measured +5. The shared helper alone does not net out: the slice removes at least 2 commands of shipped shell elsewhere in the same change, names them in its commit message, and runs `./scripts/check-shell-lines.sh pr` before it pushes.

### Readers

No reader changes its code. Measured and read in panel round 1:

| Reader | Reads | Effect |
|---|---|---|
| `account=` and `spend-rate` | the record's sum per hour | rises to the real request rate |
| `localSpenders` banner (`refusal.ts:99-109`, `board/src/server/fleet.ts:7431-7435`) | `perHour / 60` | the "N spenders" count reads requests per share, not processes; display only |
| fleet scan listing cadence `listingSpend` (`fleet-scan.ts:398-414`) | account `perHour`, cost `scanListingCost` = `1 + ceil(rows/100)` | moves most; see below |
| PR pass cadence (`pr-refresh.ts:730-737`, `:1404-1427`) | account `perHour`, self-share `PR_REQUESTS_PER_REFRESH.github = 1` (`pr-refresh.ts:221`) | at 610/hour it already sits at its 480 s ceiling; see below |
| `mine=` on the fleetd tick line (`registryd-main.ts:411-418`) | `boardSharePerHour(intervalMs, tally.calls)`, not the record | does not change; the gap between `account=` and `mine=` grows |
| `graphql_budget_spent` (`plot-host.sh:2411`), `host_concurrency_bound` (`:3822`) | `remaining`, `limit` | none |

No destructive decision reads the record or the listing. Merge, deliver, reap and release read `mergedAt` through `plot-pr-merged.sh`. A higher count only slows reads, and every cadence stretch is bounded.

### Accepted consequences

- **The fleet scan listing reads slower.** Today `scanListingCost` subtracts more than the record shows, so `othersPerHour` floors at 0 and the listing is not stretched. After the change the record agrees with the cost model. The safety juror ran `refreshIntervalMs` from `cadence.ts` for 200 steps: at an external 610 requests per hour, the #2715 idle figure, the listing interval goes from about 95 s to about 620 s; the ceiling is 760 s. A merge seen through the scan's listing, and the next wave's eligibility, can lag by up to about 12.7 minutes. The cadence was built to do this. The first listing is always permitted, and a deferred scan reuses the previous listing with its age (`listing-spend.ts:77-97`). The operator accepts this.
- **The PR pass reads its own pages as another spender's once a day.** The pass's full read is `pr-list --rich-open --state all --limit 1000` (`pr-refresh.ts:1508-1509`), up to 10 pages for its plain half, once per `PR_FULL_READ_MS` (24 h, `pr-refresh.ts:342`). Its self-share still counts 1 request per refresh, so after a full read the pass stretches for a short time on its own spend. The delta read stays 1 page. The operator accepts this; `PR_REQUESTS_PER_REFRESH` does not change.

### Known limit

A paged listing that fails partway records 1. A `gh pr list` that fails on page 10 of 18 has spent 9 requests, prints no rows, and the wrapper records 1. The count is derived from rows, so it reads low when a page is refused, which is when the account is near a limit. `gh` reports no page count, so this plan has no fix. The test for a failed listing states that 1 is a floor, not the spend.

### Out of scope

Two other `gh` calls spend more than one request per process and stay at 1. Neither is measured, and the issue names neither:

- `pr-merge-commit`'s lookup (`plot-host.sh:4295-4300`), `gh pr list --head … --limit` doubling from 100 to 200 to 400, which pages only for a head with more than 100 PRs.
- `gh api --paginate` in `gh_marker_comment_id` (`:684`), `core` bucket, 30 comments per page.

### Tests

All cases go in `test/reconcile/host.test.mjs` through `makeStubsRateAware`, `run` and `recordOf`, so `PLOT_BUDGET_HOME` sits in the stub's temp dir (`budgetEnvFor`, `host.test.mjs:326-329`). `Local checks` runs this file outside `owned-run.sh`, so no case spawns `plot-host.sh` without `PLOT_BUDGET_HOME`, and no case sets `PLOT_BUDGET_OFF`. Every case asserts the sum of `spent` over the run's lines for the bucket, never `.some(spent === N)`.

| Case | Expected sum of `spent` | Today |
|---|---|---|
| `pr-list --limit 500`, fake `gh` returns 0, 99, 100, 101, 250, 500 rows | 1, 1, 1, 2, 3, 5 (`graphql`) | 1 for each |
| `pr-list --limit 150`, 150 rows | 2 | 1 |
| the same row counts through the Jenkins, rich and plain arms | as above | 1 |
| `pr-list --rich-open`, open and all children | pages(open) + pages(all) | 2 |
| failed `gh pr list` (non-zero exit) | 1, a floor | 1 |
| GitHub `issue-list`, 250 rows | 3 | 3 |
| Bitbucket `pr-list` walking 3 pages | 3 `bitbucket` lines, each `spent` 1 | 3 |

### Open Questions

- [x] Is the derived count acceptable, or does the slice need `gh api graphql --paginate` with a per-page counter? — Derived. `GH_DEBUG=api` confirmed `ceil(R/100)` for the list and the `--search` delta, and `issue-list` already uses the derivation. A `gh` page-size change is out of reach for any test; `GH_PAGE_ROWS` names the assumption in one place. Panel round 1.
- [x] Does a paged Bitbucket listing make more than one request per call? — No change: `_bb_paged_walk` already records one line per page, and a test pins it. `bb issue list` is one process and stays unmeasured. Operator decision, panel round 1.
- [ ] Do existing records stay as they are? Lines before the change keep `spent` 1, and the window sums mix both for one hour. This plan assumes yes, because the record is append-only and windowed.
- [x] Does any test or gate pin the `spent` of a `pr-list` line to 1? — No. `host.test.mjs:7788` uses `.some`, and `budget-rotation.test.mjs` already writes lines with `spent` 5 and 7. Panel round 1.
- [ ] A paged listing that fails partway records 1 (see Known limit). Can a later change read the true spend, for example from a `GH_DEBUG` trace or a page-walked `gh api graphql`?

## Slices

### Page count

- `feature/the-spend-record-counts-a-paged` — one helper records a GitHub listing's pages past the first for `pr-list` (all three arms, through `pr_list_report_truncation`) and `issue-list`, with a separate `GH_PAGE_ROWS`; contract tests assert the sum of `spent` per row count, the failed-listing floor, `--rich-open` at the leaf, and the Bitbucket per-page lines <!-- builds: a request count on the spend record's paged lines -->

## Notes

- Created from issue #2717 by `/plot-idea`, unattended. The issue's request is the record counting each request or each line stating how many it covers; this plan takes the second form, because the line already has the field.
- Unattended defaults: `Review: pr` (the repository declares `Plan PRs: required`), `Impl: own branches`, `State: Draft` (no `Design: yes` line in the prompt).
- Deliverable search for "spend record page count" found the `plot-budget.sh` spend-record comments and `slice-spend-record.ts`, which records agent turns, not host requests. It missed the GitHub `issue-list` page record at `plot-host.sh:5465-5467` (#1653), which the panel found and this plan now builds on.
- This plan's panel, round 1: `.plot/panels/2026-10-27-the-spend-record-counts-a-paged/` (rootcause, code, safety, tests; unanimous amend). The operator chose `pages − 1` through one helper shared with `issue-list`, a separate GitHub page constant, Bitbucket unchanged with a pinning test, the slower scan cadence as an accepted consequence, and the failed-listing under-count as a named limit. The `mine=` before-and-after acceptance is dropped, because `mine=` does not read the record.

# Juror verdict — lens: tests

Plan: `docs/plans/2026-10-27-the-spend-record-counts-a-paged.md` (PR #2761, issue #2717). Code cited from `pmain` (current `origin/main`).

Position: amend

## Summary

The defect is real and a test reproduces it on today's code. I ran it: a fake `gh` returning 250 rows makes `plot-host.sh pr-list --state merged --limit 500` write one `graphql` line with `spent` 1, where `gh` makes 3 requests. The plan's acceptance is therefore checkable. But the plan's account of `issue-list` is wrong, its mechanism double-counts unless the test sums `spent`, and the acceptance does not name the assertions that would catch either mistake. The plan also prices no `check-shell-lines.sh` cost. These are fixable before approval.

## 1. The problem

- **Ran.** In a scratch dir with `PLOT_BUDGET_HOME` set to a temp dir, `PLOT_HOST=github` and a fake `gh` returning 250 rows: `pr-list --state merged --limit 500` → 1 line, `graphql`, `spent` 1. `pr-list --state all --limit 3000` → 1 line, `spent` 1. `issue-list --limit 500` → **3 lines**, each `spent` 1.
- **Read.** The cause is as the plan names it: the `gh()` wrapper (`plot-host.sh:3885-3892`) calls `budget_record_call` once per process, and `budget_record_call` (`:3651-3671`) passes a literal `1` to `budget_append` on both paths. All three GitHub `pr-list` arms run `gh pr list` through that wrapper inside `pr_list_call` (`:4731`, `:4776`, `:4808`).
- **Read — the plan's Design step 3 is false.** It says `issue-list` "pages through its own `--page-token`, one request per call, and stays at 1". The GitHub arm of `issue-list` already records each page past the first: `plot-host.sh:5465-5467` (`jq -r "[range(1; length / $ISSUE_PAGE_ROWS | ceil)]" … | while read -r _; do budget_record_call github github graphql; done`, added in `ce6602da9`, #1653). `--page-token` is the Jira arm. So the repository already holds the exact derivation the plan proposes, for a sibling listing, and the plan neither reuses nor mentions it. My run above confirms it works (250 rows → 3 lines).
- **Read — scope.** Other multi-request `gh` processes record 1: `pr-merge-commit`'s doubling loop (`:4295-4300`, `--limit` 100, 200, 400…, so 2+ pages per call past the first) and `gh api --paginate` in `gh_marker_comment_id` (`:684`, `core`). The issue measures neither, so leaving them out is defensible, but the plan should name them as out of scope rather than claim "other `gh` calls stay at 1" as if each were one request.
- **Read — Bitbucket (answers Open Question 2).** `bb api` makes one request per process (`plot-host.sh:1329-1331`), and the paged walk calls it once per page through the `bb()` wrapper (`:3895-3901`). A paged Bitbucket listing therefore already records one line per request. No Bitbucket change is needed; a test should pin that it stays so.

## 2. The approach, from the test side

- **Read — the mechanism double-counts unless the test sums.** Design step 2 adds a fourth argument to `budget_record_call` "in place of the literal 1". But the `gh pr list` call is recorded by the wrapper inside the `pr_list_call` command substitution, before any row count exists. The count is only known in the parent, after `_gh_raw` returns (`:4733`, `:4778`, `:4810` already compute `jq 'length'` for `pr_list_report_truncation`). So the slice must either record `pages − 1` extra (the `issue-list` precedent) or bypass the wrapper. If it records a line with `spent` = N beside the wrapper's line with `spent` 1, the record says N+1. A test that asserts "some line has `spent` 3" passes on that bug. The acceptance must assert the **sum of `spent` over all `graphql` lines the run wrote**.
- **Read — the existing test does not pin 1.** `host.test.mjs:7788` ("a GraphQL call is recorded against graphql") asserts `.some(bucket === 'graphql')` only. `budget-rotation.test.mjs` already writes lines with `spent` 5 and 7 and the readers sum them (`plot-budget.sh:613,628`; `budget-record.ts:195`). So no existing test breaks, which also means no existing test proves the change. Open Question 4 is answered: nothing pins it.

## 3. PLOT_BUDGET_HOME

- **Read.** The host harness already isolates the record: `budgetEnvFor` (`host.test.mjs:326-329`) sets `PLOT_BUDGET_HOME` inside the stub dir for `run`/`runAllowFail`, `makeStubsRateAware` seeds it, and `recordOf` (`:7648-7659`) decodes it. `test:contracts` also runs under `scripts/owned-run.sh`, which sets `PLOT_BUDGET_HOME` (`owned-run.sh:260`).
- **Read — the gap.** `## Plot Config` → `Local checks` runs `node --test test/reconcile/*.test.mjs` directly, outside `owned-run.sh`. A new test that spawns `plot-host.sh` through its own `spawnSync` (not `run`) and omits `PLOT_BUDGET_HOME` writes into the operator's `~/.plot/state/budget.tsv` on every local run. The plan should require the new cases to go through `makeStubsRateAware` + `run` + `recordOf`, or pass `PLOT_BUDGET_HOME` explicitly, and must not set `PLOT_BUDGET_OFF` (that would make the record assertion vacuous).

## 4. Slice and acceptance

- One slice, one observable result: right size and order.
- The acceptance "contract tests cover the row-count boundaries and the unchanged `1` of every other caller" is checkable but too loose. "Every other caller" is unbounded, and the boundary list does not state expected sums. It needs a concrete table (amendment A2).
- The "Readers" section asks for a before/after `mine=` sample in the commit message. That is a live-host measurement, not a test, and it is fine as a note but must not stand as acceptance.
- `ceil(R / 100)` assumes `gh`'s page size of 100. The test cannot detect a `gh` change, and no test should pretend to. The constant should be shared with `ISSUE_PAGE_ROWS` (`:647`) or a sibling, so one place states the assumption.

## 5. New defects and gates

- **`check-shell-lines.sh`.** The ratchet refuses net growth of shipped shell against the merge base. Three `pr-list` arms gaining a record call plus a fourth parameter in `budget_record_call` grow `plot-host.sh`. The plan names no offset. The natural one: a single helper (e.g. `gh_record_pages <rows> <bucket>`) used by the three `pr-list` arms and by `issue-list:5467`, or one call inside `pr_list_report_truncation`'s GitHub branch, which already receives the row count for all three arms. The plan should say which, and run `scripts/check-shell-lines.sh` before push.
- **Failure path.** A failed `gh pr list` exits through `pr_list_failed` in the subshell. The wrapper still records 1 there, which is right (the issue counts a failed call as spent). A test should pin that a failed listing records exactly 1, so the parent-side count never runs on an empty `_gh_raw` and records extra.
- **`--rich-open`.** It re-invokes `"$0" pr-list` twice (`plot-host.sh` ~`:4623`, `:4630`). Each child counts its own pages. A test with the split read should assert the sum is the two children's pages, not more.
- **Gate.** No new CI gate is needed; this is a value change inside one writer, and a contract test is the right enforcement. A corpus pair is not warranted: no TypeScript rule duplicates the page derivation.
- **bash 3.2.** `$(( (R + 99) / 100 ))` and `jq` are both fine. `scripts/check-bash32-syntax.sh` covers the rest.
- **Adopting repos.** Behaviour is GitHub-only and derived from the response length, so it needs no config. Bitbucket and Jenkins stay as they are.

## Amendments

1. **A1 — Correct Design step 3 and reuse the precedent.** State that GitHub `issue-list` already records each page past the first (`plot-host.sh:5465-5467`, #1653) with the same `ceil(rows/100)` derivation. Build `pr-list` on that mechanism or a helper both share, not on a fourth argument to `budget_record_call` that the wrapper's own line would add to.
2. **A2 — Make the acceptance a sum table that fails today.** In `test/reconcile/host.test.mjs`, using `makeStubsRateAware`/`run`/`recordOf`: for a fake `gh pr list` returning 0, 99, 100, 101, 250 and 500 rows with `--limit 500`, the sum of `spent` over the run's `graphql` lines is 1, 1, 1, 2, 3 and 5. Also: `--limit 150` with 150 rows → 2. Today these read 1 for every case (I ran the 250-row case: 1). Assert the sum, never `.some(spent === N)`.
3. **A3 — Name the cases that stay unchanged, by test.** A failed `gh pr list` (non-zero exit) → sum 1. `pr-view`/`pr-state` → 1. GitHub `issue-list` with 250 rows → sum 3 (pins the existing, currently untested, page record at `:5467`). Bitbucket `pr-list` walking 3 linked pages → 3 `bitbucket` lines (one per `bb api` call). `--rich-open` → the sum of both children's pages.
4. **A4 — Keep the record isolated.** Every new case runs with `PLOT_BUDGET_HOME` inside its own temp dir (via `budgetEnvFor` or explicitly) and with `PLOT_BUDGET_OFF` unset, because `Local checks` runs this file outside `owned-run.sh`.
5. **A5 — Price the shell-line ratchet.** Name the offset that keeps `scripts/check-shell-lines.sh` at or below its merge base, for example folding the `issue-list` loop at `:5467` and the three `pr-list` sites into one helper.
6. **A6 — Name what stays out of scope.** `pr-merge-commit`'s doubling loop (`:4295-4300`) and `gh api --paginate` (`:684`) also spend more than one request per process. List them as known, unmeasured, and out of scope, so "other `gh` calls stay at 1" is not read as "are one request".
7. **A7 — Close Open Questions 2 and 4 with the facts above.** Bitbucket already records per page (one `bb api` per page). No test pins a `pr-list` line's `spent` to 1 (`host.test.mjs:7788` uses `.some`).

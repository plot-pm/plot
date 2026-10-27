# Panel round 1 — moderation

Subject: `docs/plans/2026-10-27-the-spend-record-counts-a-paged.md` (plan PR #2761, issue #2717).

Gate: `plot-panel.mjs check Position proceed,amend,reject` committed all four files. Reconcile: `unanimous amend rootcause,code,safety,tests`.

## What each juror looked at

- **rootcause** ran `plot-host.sh pr-list` and `issue-list` against a fake `gh` returning 0 to 500 rows, with a scratch `PLOT_BUDGET_HOME`, and read the `bb` paged walk and every multi-request `gh` site.
- **code** ran the real `gh pr list` with `GH_DEBUG=api` (250 rows made 3 requests; a 150-row `--search` delta made 2), and read the readers, the cadence rule and the fleetd tick.
- **safety** ran `refreshIntervalMs` from `cadence.ts` in a 200-step simulation of the scan listing's cadence before and after the fix, and read every reader of the record.
- **tests** ran the fake-`gh` reproduction (250 rows record `spent` 1 for `pr-list`, 3 lines for `issue-list`), and read the host harness (`budgetEnvFor`, `recordOf`) and the existing budget tests.

## Agreed by all four

1. **The defect reproduces.** The `gh()` wrapper (`plot-host.sh:3885-3892`) records one line per process, and `budget_record_call` (`:3651-3671`) writes a literal `1`. A paged `pr-list` records `spent` 1 (ran by rootcause and tests).
2. **Design step 3 is false.** GitHub `issue-list` pages inside `gh issue list` and already records each page past the first at `plot-host.sh:5466-5467` (`ce6602da9`, #1653). `--page-token` is the Jira arm. The Notes line "nothing builds a request count" is false for the same reason.
3. **The mechanism as written double-counts.** The wrapper writes its `1` inside the `pr_list_call` substitution before rows are known. A second record of `N` gives `N + 1`. The extra record is `pages − 1`, after the call, as `issue-list` does.
4. **One shared helper** for `issue-list` and the three `pr-list` sites (`:4731`, `:4776`, `:4808`) replaces the `jq | while` loop at `:5467` and pays the `check-shell-lines.sh` cost the plan does not name.
5. **`--rich-open` counts at the leaf.** Its two child `pr-list` processes each record their own pages; the parent records nothing.
6. **Acceptance asserts the sum of `spent`**, never `.some(spent === N)`: 500 rows sum to 5, not 6. A failed listing records 1. No existing test pins a `pr-list` line to 1 (`host.test.mjs:7788` uses `.some`).
7. **Nothing destructive reads the record.** `graphql_budget_spent` (`:2411`) reads `remaining`; `host_concurrency_bound` (`:3822`) reads `limit`. Merge, deliver, reap and release read `mergedAt`. A higher count only slows reads.
8. **One slice is the right size.**

## Disagreements

**1. Does Bitbucket have the same defect?** code: yes, citing `registryd-main.ts:801-805` ("500 rows would cost 10 requests per tick"), and asks for a follow-up issue. rootcause and tests: no; `_bb_paged_walk` (`plot-host.sh:1158-1185`) runs one `bb … api` per page, and each passes through the `bb()` wrapper, so each page records one line. The code on main supports rootcause and tests: the comment code cites counts requests the walk already records one by one. Only `bb issue list` (one process) stays unmeasured. Open Question 2 closes with "no change", and a test pins the per-page lines.

**2. Does `mine=` read the record?** rootcause: yes, the larger `spent` reaches `mine=` with no reader change. code and safety: no; `minePerHour` is `boardSharePerHour(intervalMs, calls)` (`registryd-main.ts:411-418`), which counts the tick's calls. The code supports code and safety. `account=` moves, `mine=` does not, and the plan's acceptance "record `mine=` before and after" cannot fail.

**3. Which reader moves most.** safety: the fleet scan listing. `scanListingCost` already prices it at `1 + ceil(rows/100)` (19 at 1,767 PRs), so after the fix its cadence counts others' real load; at an external 610/hr the interval rises from about 95 s to about 620 s (ran), capped at 760 s, which delays wave eligibility seen through the listing. code: the PR pass's self-share `PR_REQUESTS_PER_REFRESH.github = 1` (`pr-refresh.ts:221`) against a daily 10-page full read, so the pass reads its own pages as another spender's once a day. safety ran the PR pass cadence and found it already at its 480 s ceiling. These do not contradict each other; the plan names neither, and safety's figure is the only measured consequence.

**4. The page-size constant.** code, safety and tests reuse `ISSUE_PAGE_ROWS` (`:647`) or a renamed shared constant. rootcause keeps a separate GitHub constant, because `ISSUE_PAGE_ROWS` is also the Jira page bound (`:5372-5373`), and a Jira change would then change the GitHub count. The code supports rootcause: the existing `issue-list` loop at `:5467` already couples GitHub's count to a Jira bound, and the shared helper should fix that rather than spread it.

**5. Scope of other multi-request `gh` calls.** rootcause and tests name `pr-merge-commit`'s doubling `--limit` loop (`:4295-4300`) and `gh api --paginate` (`:684`, `core`) and ask the plan to include them or list them as out of scope. code and safety do not name them.

## Shared blind spot

All four accept that a failed paged listing records exactly 1. A paged `gh pr list` that fails on page 10 of 18 has spent 9 requests, prints no rows, and records 1. The count is derived from rows, so it under-reads exactly when the account is near a limit and a page is refused, which is when the cadence needs the true spend. The fix is not obvious, since `gh` reports no page count, but the plan should name the case as a known under-count, and the test for a failed listing should state that 1 is a floor, not the spend.

## Named amendments for the plan

1. Correct Design step 3 and the Notes: GitHub `issue-list` already records pages past the first (`plot-host.sh:5466-5467`, #1653). Name it as the precedent.
2. Replace Design step 2: after the call, record `pages − 1` through one helper shared with `issue-list`. The `gh()` wrapper and `budget_record_call`'s callers stay unchanged.
3. Decide disagreement 4: a GitHub page constant separate from `ISSUE_PAGE_ROWS` (recommended), or one renamed shared constant.
4. Count `--rich-open` at the leaf only.
5. Rewrite the Readers section: `account=`, `localSpenders` and the scan listing's cadence move; `mine=` does not. Name the scan listing's measured interval change (about 95 s to about 620 s at 610/hr) and the PR pass self-share mismatch, and accept or change each.
6. Close Open Question 2 from the code: the Bitbucket walk already records per page; add a test that pins it.
7. Close Open Question 4: nothing pins `spent` 1.
8. List `pr-merge-commit` (`:4295-4300`) and `gh api --paginate` (`:684`) as in or out of scope.
9. Acceptance in `host.test.mjs` through `makeStubsRateAware`/`run`/`recordOf` with an isolated `PLOT_BUDGET_HOME`: sums 1, 1, 1, 2, 3, 5 for 0, 99, 100, 101, 250, 500 rows; failed listing 1; `issue-list` 250 rows sums 3; `--rich-open` sums both children; every arm (Jenkins, rich, plain).
10. Name the `check-shell-lines.sh` offset.
11. Say in the comment and Changelog that `spent` counts requests, not GraphQL points, and scope the Changelog to GitHub.
12. Name the failed-listing under-count from the blind spot.

# Juror verdict — code lens

Plan: `docs/plans/2026-10-27-the-spend-record-counts-a-paged.md` (PR #2761, issue #2717). Code read at `pmain` (`4a1b8a5fa`, origin/main).

Position: amend

## 1. The problem

- **Confirmed (read).** `budget_record_call` (`skills/plot/scripts/plot-host.sh:3651`) calls `budget_append … 1 …` on both paths (`:3665`, `:3670`). The `gh()` wrapper (`:3885-3892`) records one line per `gh` process after the call returns. `pr_list_call` (`:905`) runs `"$@"`, so each of the three `gh pr list` sites in the `pr-list` GitHub arm (`:4731` Jenkins arm, `:4776` rich arm, `:4808` plain arm) records exactly one line.
- **Confirmed (ran).** `GH_DEBUG=api gh pr list --state all --limit 250` made 3 GraphQL requests (`limit` 100, 100, 50) for 250 rows, with and without `statusCheckRollup`. The `--search "updated:>…"` form (the delta) also pages at 100: 150 rows made 2 requests. So `max(1, ceil(R/100))` is the real request count for both the list and the search path.
- **Cited lines hold (read).** `registryd-main.ts:791` is `mergedBranches`; the `--limit 500` full listing is at `:807-810`. `plot-fleet-scan.sh:1063` is the `pr-list --state all --limit "$PR_LIST_LIMIT"` call; `PR_LIST_LIMIT` defaults to 3000 (`:691`).
- **Scope is overstated in one place (read).** The fleetd tick asks the 500-row full listing only on a fallback. In steady state it asks the delta `host.prList('merged', limit, window.since)` (`registryd-main.ts:850-852`), which is one page. The "about 5 pages per tick" in the issue is the fallback cost, not the steady-state cost.
- **Scope misses the same defect on Bitbucket (read).** `registryd-main.ts:801-805` states that `bb` pages up to its row limit and that 500 rows "would cost 10 requests per tick". The `bb()` wrapper (`:3894-3900`) also records one line per process. The plan defers this to an Open Question; that is acceptable, but the Changelog must say "GitHub" and a follow-up issue should exist.

## 2. The approach against the code

- **An existing mechanism already does this, and the plan says it does not exist (read).** The GitHub `issue-list` arm records each page past the first: `plot-host.sh:5466-5467`, *"`gh` pages by 100 inside ONE process and the wrapper records one call per process, so each page past the first is recorded here"*, implemented as `jq -r "[range(1; length / $ISSUE_PAGE_ROWS | ceil)] | .[]" | while read -r _; do budget_record_call github github graphql; done` (since `ce6602da9`, #1653). The plan's Design item 3 ("`issue-list` pages through its own `--page-token`, one request per call, and stays at `1`") is false for GitHub: `--page-token` is the Jira/Bitbucket read (`:5207`, `:5284`, `:5315`). The plan's deliverable search missed this.
- **The plan's write path double-counts as written (read).** Design item 2 passes the request count to `budget_record_call` "in place of the literal `1`". But the `gh()` wrapper has already written its `1` line by the time `pr_list_call` returns and rows can be counted; the count is not known inside the wrapper. A slice that adds a second `budget_record_call … N` records `N + 1`. The correct form is the `issue-list` form: after the call, record `pages - 1` more. With the proposed fourth argument this is one line `spent = pages - 1` (skipped when 0), not a loop of lines.
- **Layer is right (read).** `plot-host.sh` is the host connector adapter (CLAUDE.md, The Layering Rule: "Only a connector … records what a call spent"). The record writer, the page size and the `gh` process all live there, and `plot-fleet-scan.sh` reaches GitHub only through it. A TypeScript count in `host-shell.ts` would miss every shell caller. No domain change is needed: `decodeBudgetLine` (`packages/domain/src/entities/budget.ts:181-189`) already parses any finite `spent`, and both readers sum it (`plot-budget.sh` awk `spent += c_spent[i]`, `packages/domain/src/rules/budget-record.ts:195`).
- **Shell-line cost (read).** `check-shell-lines.sh` counts commands and refuses growth against the merge base, with no allowance. Three new call-site lines plus a helper grow `plot-host.sh`. The plan names no offset. One shared helper (for example `budget_record_pages <rows>` that writes one `spent = pages - 1` line) used by the `issue-list` arm and the three `pr-list` sites replaces the `jq | while` loop at `:5467` and keeps the count near flat.

## 3. Safety

- No destructive path (read). The record feeds `spend-rate` (`account=`), `localSpenders` (`packages/domain/src/rules/refusal.ts:99`, called at `packages/board/src/server/fleet.ts:7431`) and the cadence stretch. `graphql_budget_spent` (`plot-host.sh:2411`) reads only `remaining` and `basis`, and `host_concurrency_bound` (`:3822`) reads only `limit` and `basis`; neither moves. A higher recorded spend makes the cadence slower, which is the conservative direction. A double count (section 2) also errs slow, never fast.
- **The plan's account of the readers is wrong in two places (read).**
  - `mine=` does not read the record. `spendForTick` sets `minePerHour: boardSharePerHour(intervalMs, calls)` (`registryd-main.ts:410-418`) from `tally.calls`, which adds 1 per `prList` (`:809`, `:851`). The change moves `account=`, not `mine=`. The plan's "`mine=` rises by about 4 per tick" and the commit-message before/after for `mine=` are therefore wrong.
  - The cadence subtracts a DERIVED self-share: `othersPerHour = perHour − boardSharePerHour(interval, costPerRefresh)` (`packages/domain/src/rules/cadence.ts:97-101`), with `PR_REQUESTS_PER_REFRESH.github = 1` (`packages/fleet/src/shared/pr-refresh.ts:219-224`). The PR pass's full read is `pr-list --rich-open --state all --limit 1000` (`pr-refresh.ts:1508-1509`, `PR_LIMIT` at `:314`), whose plain half is up to 10 pages. After the change those pages enter `perHour` while the self-share still counts 1, so the pass reads its own pages as another spender's — the "chases its own tail" case the `cadence.ts:78-83` comment exists to prevent. The full read runs once per `PR_FULL_READ_MS` (24 h, `:342`), so the effect is one short stretch a day, and the delta stays 1 page. The plan's "No reader changes its code" can stand, but it must state this mismatch and accept it by measurement rather than leave it unnamed.

## 4. Slices against Changelog and acceptance

- One slice, one observable result: the `spent` sum for the `github/<account>/graphql` key after a 101-row `pr-list`. On today's code it is 1; after it must be 2. That test fails on today's code. Good.
- Missing acceptance cases: (a) the sum is exactly `ceil(R/100)`, not `ceil(R/100) + 1`, the double-count guard; (b) all three `pr-list` arms (Jenkins, rich, plain), and `--rich-open`, whose two recursive sub-processes (`:4597-4615`) each count their own rows; (c) the `issue-list` arm still records the same total after it moves onto the shared helper; (d) a failed `gh pr list` (non-zero, no rows) still records 1.
- The row-count boundaries the plan names (0, 99, 100, 101, 500) are the right ones; 0 must give 1.

## 5. New defects

- Bash 3.2: the arithmetic `$(( (R + 99) / 100 ))` is safe; the existing jq form also works. No `mapfile`, no `${x,,}`.
- Bitbucket: unchanged, which is correct for this slice; the deferred question is real (section 1).
- Adopting repos: no config key; the page size 100 is `gh`'s, the same constant `ISSUE_PAGE_ROWS=100` (`:647`) already assumes. Reusing `ISSUE_PAGE_ROWS` (or renaming it to a GitHub page constant) avoids a second literal 100.
- Tests: `test/reconcile/budget.test.mjs` and `host.test.mjs` read `budget.tsv`; I found no assertion that pins a `pr-list` line's `spent` to 1 (grep, read), but the slice must run the whole `test/reconcile/*budget*` and `host.test.mjs` names it touches.

## Amendments

1. **Reuse the existing per-page mechanism.** Name `plot-host.sh:5466-5467` as prior art, correct Design item 3 (GitHub `issue-list` already counts pages; `--page-token` is Jira/Bitbucket), and move both `issue-list` and the three `pr-list` sites onto one helper that records `pages - 1` after the call.
2. **Fix the double count in Design item 2.** The `gh()` wrapper already writes `1`; the extra record is `pages - 1`, never `pages`. Add an acceptance test that the sum equals `ceil(R/100)` exactly.
3. **Correct the Readers section.** Remove `mine=` as a reader (it is `boardSharePerHour(intervalMs, tally.calls)`, `registryd-main.ts:417`); name `account=`/`spend-rate`, `localSpenders` and the cadence stretch; state that the steady-state fleetd tick asks a one-page delta.
4. **Name the self-share mismatch.** `PR_REQUESTS_PER_REFRESH.github = 1` against a daily 10-page full read; accept it with a measured figure, or decide to change it.
5. **Name the shell-line offset** that pays for the change under `check-shell-lines.sh`.
6. **Scope the Changelog to GitHub** and open a follow-up issue for `bb` row-limit paging (`registryd-main.ts:801-805`).
7. **Cover every arm in the tests:** Jenkins, rich, plain and `--rich-open`, plus the failed-call case recording 1.

# Juror verdict — safety lens

Plan: `docs/plans/2026-10-27-the-spend-record-counts-a-paged.md` (PR #2761, issue #2717). Code read at `pmain` (origin/main). Lens: what reads the spend record, and whether a correct page count makes a reader back off too hard, stop a fleet, or double-count.

Position: amend

## 1. The problem

- **Read:** `budget_record_call` (`plot-host.sh:3651-3671`) writes `spent` 1 on both paths. The `gh` wrapper (`plot-host.sh:3884-3891`) calls it once per process. `pr_list_call` (`plot-host.sh:905-916`) runs `gh pr list --limit N` as one process, so a paged listing records one line. The plan's account holds.
- **Read:** the scope statement about `issue-list` is wrong. On GitHub `issue-list` is `gh issue list --limit N` (`plot-host.sh:5456`), paged inside one process like `pr-list`. It does not page through `--page-token` on GitHub. `plot-host.sh:5463-5466` already records each page past the first as an extra `budget_record_call github github graphql` line. So the defect is already fixed for `issue-list`, and that fix is the existing mechanism the plan should reuse.

## 2. Every reader of the record, and what the change does to it

| Reader | Where | Reads | Effect of a correct page count |
|---|---|---|---|
| Routing gate `graphql_budget_spent` | `plot-host.sh:2411-2432` | `remaining` of the newest `actual` line | None. It never reads `spent`. (read) |
| Concurrency slot bound | `plot-host.sh:3823-3836` | `limit` and `basis` | None. (read) |
| PR pass cadence `prRefreshMsFor` | `pr-refresh.ts:730-737`, `:1404-1427` | account `perHour`, cost `PR_REQUESTS_PER_REFRESH.github = 1` | Bounded by `MAX_CADENCE_STRETCH` 8. At 610/hr it already sits at 480 s; at 1100/hr it stays at 480 s. No change in practice. (ran `refreshIntervalMs` from `cadence.ts`) |
| Issue gate subtraction `cadenceRateOf` | `cadence.ts:326-344` | the gate's own `requests` | `requests` comes from `tracker-shell.ts:264-297` as `max(calls, ceil(rows/100))`, which already matches the extra lines at `plot-host.sh:5463-5466`. Consistent today. A slice that also counts `issue list` pages in the wrapper or in `budget_record_call` double-counts here. (read) |
| Fleet scan listing `listingSpend` | `fleet-scan.ts:398-414`, cost `scanListingCost` `fleet-scan.ts:119-126` | account `perHour`, cost `1 + ceil(rows/100)` | **The largest effect, and the plan does not name it.** See below. (ran) |
| `localSpenders` banner | `refusal.ts:99-109`, `board/src/server/fleet.ts:7431-7435` | `perHour / 60` | The "N spenders" count on a secondary-limit banner rises with page counts; one scan of 18 pages reads as more spenders. Display only. (read) |
| `mine=` on the tick line | `registryd-main.ts:411-418` | **not the record**: `boardSharePerHour(intervalMs, tally.calls)` | Does not change. `account=` rises and `mine=` stays, so the gap between them grows. The plan's claim that `mine=` "rises by about 4 per tick" is false. (read) |
| Backoff (issue gate `backoffUntil`, PR pass `prNextIsBackoff`) | `issue-refresh.ts:453-458`, `:549-554`; `pr-refresh.ts:1430-1441` | refusals via `hostReaction`, not spend | None. (read) |

**The fleet scan listing.** `scanListingCost` already prices the scan's listing at `1 + ceil(rows/100)` requests (19 at 1,767 PRs), and `listingSpend` subtracts that share from the account rate. Today the record shows about one line per listing, so the scan subtracts more than it recorded, `othersPerHour` floors at 0, and the listing stays unstretched. After the fix the record agrees with the cost model, so every other spender's real load counts. I simulated `refreshIntervalMs(5000, 19, …)` from `cadence.ts` with the scan's own recorded spend fed back into `perHour` (ran, 200 steps):

| external spend /hr | today (≈2 lines per listing) | after (19 requests per listing) |
|---|---|---|
| 100 | 95 s | 110 s |
| 300 | 95 s | 163 s |
| 500 | 95 s | 311 s |
| 610 (the #2715 idle figure) | 95 s | 622 s |
| 700 | 356 s | 760 s (ceiling) |

So at today's idle rate the scan's PR listing moves from about 95 s to about 10 minutes, and the external rate itself rises after the fix (fleetd's full `--limit 500` fallback becomes 5 per call). That is what the cadence was built to do, and it is bounded at 8x. It does not stop a fleet: `listingSpend` always permits the first listing, and a deferred scan reuses the previous listing with its age (`listing-spend.ts:77-97`). No destructive decision reads the listing or the record — merge, deliver, reap and release read `mergedAt` through `plot-pr-merged.sh`. The cost is freshness: a slice merge seen through the scan's listing, and so the next wave's eligibility, can lag up to about 12.7 minutes. The plan must name this as the main consequence, not the PR pass.

## 3. Safety — double-count paths

- **The wrapper already records 1.** `pr_list_call` runs `gh` inside a command substitution, and the `gh` wrapper records one line there (`plot-host.sh:3890`). The outer `pr-list` arm learns the row count only after that. Design step 2 ("passes it to `budget_append` in place of the literal 1") cannot reach the wrapper's line from the arm. A slice that adds a `budget_record_call … N` after the listing records N+1. The correct count to add is pages past the first, `ceil(R/100) - 1`, which is exactly the `issue-list` precedent at `plot-host.sh:5466`. (read)
- **`--rich-open` recurses.** A full read with `--rich-open` (`pr-refresh.ts:1510`, `plot-host.sh:4609-4650`) runs `"$0" pr-list --rich --state open` and `"$0" pr-list --state all` as two child processes. Each child records its own pages. The parent must record nothing for the listing, or each page counts twice. (read)
- **`issue-list` must stay as it is.** Any generalisation into the `gh` wrapper by argv (`gh issue list`, `gh pr list`) double-counts `issue-list` against `plot-host.sh:5466` and breaks the agreement `cadenceRateOf` relies on. (read)
- **Page size is a second implementation.** `scanListingCost` (TS) and `ISSUE_PAGE_ROWS=100` (`plot-host.sh:647`) already derive pages from rows at 100. A third shell derivation is a declared duplicate under "A Shell Script Asks The Domain"; it should reuse `ISSUE_PAGE_ROWS` (or a renamed shared constant) and the plan should say so. (read)
- **Format and decoders accept it.** `budget_num` accepts any integer (`plot-budget.sh:97-102`); the awk reader sums `$6` (`plot-budget.sh:613`, `:628`); `decodeEntry` reads `spent` as a number (`entities/budget.ts:181-185`). No reader caps `spent`. (read)

## 4. Slices and acceptance

One slice is right. Its acceptance does not yet fail on the double-count above. The row-count boundary test (0, 99, 100, 101, 500) must assert the **sum of `spent` across all lines** for one `pr-list` call, so a 500-row listing sums to 5 and not 6, and a `--rich-open` call sums to pages(open) + pages(all). The "record before and after `mine=` in the commit message" acceptance is uncheckable because `mine=` does not read the record.

## 5. New defects

- Bash 3.2: the precedent loop at `plot-host.sh:5466` uses `jq` and `while read` and is 3.2-safe; an arithmetic `$(( (R + 99) / 100 - 1 ))` is cheaper and adds fewer lines against `check-shell-lines.sh`. (read)
- Bitbucket: staying at 1 under-counts, which errs toward less stretch. That is the safe direction and acceptable as scope. (read)

## Amendments

1. **Record pages past the first, not the page count.** The `gh` wrapper already writes one line inside `pr_list_call`'s subshell. Add `ceil(R/100) - 1` after the listing, following `plot-host.sh:5463-5466`, and test that the sum of `spent` for one 500-row call is 5.
2. **Count only at the leaf.** A `--rich-open` read counts in its two child `pr-list` processes and nowhere in the parent. Add a test for the sum.
3. **Correct the `issue-list` statement.** On GitHub `issue-list` pages inside `gh issue list` and already records its extra pages at `plot-host.sh:5466`. State that the slice changes neither that loop nor the `gh` wrapper, because `cadenceRateOf` subtracts the gate's `requests` (`tracker-shell.ts:297`) and must keep matching the record.
4. **Correct the Readers section.** `mine=` is `boardSharePerHour(intervalMs, tally.calls)` (`registryd-main.ts:417`) and does not move; `account=` does. Remove the `mine=` acceptance, or add a separate change that makes `tally` count pages.
5. **Name the fleet scan listing as the reader that moves most.** At an external 610/hr its listing interval goes from about 95 s to about 620 s (ceiling 760 s). State that this is intended, that it delays wave eligibility seen through the listing, and that no destructive decision reads it. Record the measured interval before and after in the slice.
6. **Share the page size.** Derive pages from the existing `ISSUE_PAGE_ROWS` (or one renamed constant) rather than a third literal 100, and declare the pairing with `scanListingCost` per "A Shell Script Asks The Domain".
7. **Note the `localSpenders` banner.** The secondary-limit "N spenders" count now reads requests per share, not processes. Accept it in the plan or file it.

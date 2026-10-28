# Juror verdict: testability

Position: amend
Evidence: Read the plan, issue #2815, `packages/fleet/src/shared/fleet-scan.ts`, `packages/fleet/src/shared/fleet-clock.ts`, `packages/fleet/src/server/entry/registryd-main.ts`, `packages/fleet/src/server/entry/registryd.ts`, `packages/domain/src/rules/cadence.ts`, `packages/domain/src/rules/listing-spend.ts`, `skills/plot/scripts/plot-fleet-scan.sh`, `skills/plot/scripts/plot-budget.sh`, `skills/plot/scripts/plot-host.sh` (pr-list `--since`), `packages/board/src/server/fleet.ts:2720-2730`, `test/reconcile/fleetlisting.test.mjs`, `packages/fleet/test/unit/fleet-scan.test.ts`, `packages/fleet/test/unit/registryd-main.test.ts:1495-1520`, and the earlier plans `2026-09-29-a-spend-line-names-its-caller` (Rejected), `2026-09-29-a-daemon-spends-within-its-means` (Released), `2026-10-01-a-shared-account-names-what-spends-it` (Released), `2026-10-26-the-fleet-scan-re-reads-all` (Released). Ran: a node script that imports `cadence.ts` and settles `refreshIntervalMs` for the scan's Bitbucket listing (5, 10, 20 tracked branches; account 0, 500, 1000, 3664/hr); `vitest run` on `test/listing-spend.test.ts`, `test/cadence.test.ts`, `test/scan-listing.test.ts` (domain, 90 passed) and `test/unit/fleet-scan.test.ts` (fleet, 20 passed). No host call was made.

## (a) Problem statement

1. **The scan does not run on the 60 s tick.** The scan runs on the fleet clock's 5 s pulse: `REFRESH_MS = 5_000` (`fleet-scan.ts:20`), divisor 1 for `fleet-scan` (`fleet-clock.ts:32`), driven by `startFleetClock` with `scan: fleetScan(...)` (`registryd-main.ts:2570-2571`). The 60 s figure is `TICK_INTERVAL_MS` (`registryd.ts:81`), which is the supervisor tick, a different loop. The plan title, the Motivation and slice 1 ("the tick attributes those entries to its own run") all name the wrong loop. This matters for slice 1: `HostTally` (`registryd-main.ts:405-421`) counts only the tick's two worlds. The scan, the PR reader (`fleetPrs`) and the issue reader all spend on the clock, outside any tally.
2. **The `mine=60/hr` figure is one call per tick.** `boardSharePerHour(60_000, 1) = 60`. `registryd-main.test.ts:1505-1517` describes exactly that call: the nothing-done step's one `pr-state`. The tick line is correct for the tick. It does not cover the clock.
3. **Cause 4 is partly false.** The scan's listing already has a budget. `scanOnce` asks `listingSpend` with `scanListingCost` and `spendRateFor` (`fleet-scan.ts:500-518`), and the Bitbucket arm prices a listing at 3 requests per tracked branch (`fleet-scan.ts:133-137`). I executed `refreshIntervalMs` for that input:

   | tracked branches | account/hr | settled interval | listing requests/hr |
   |---|---|---|---|
   | 10 | 0 | 150 s | 720 |
   | 20 | 0 | 300 s | 720 |
   | 20 | 1000 | 2400 s | 90 |
   | 20 | 3664 | 2400 s | 90 |

   Two facts follow. First, the listing already backs off under pressure, down to the `MAX_CADENCE_STRETCH = 8` ceiling (`cadence.ts:28`). Second, the scan's unstretched share is **720 requests/hr on every host**, because the share is `HOUR / REFRESH_MS` (`boardSharePerHour(5000*30, 30) = 720`), against 60/hr for the board's 60 s base. On a Bitbucket account of about 1000/hr, an idle fleetd's listing alone may take 72 % of the account. The plan does not name this. It is a candidate cause on its own and needs no new mechanism, only a different base interval for the listing.
4. **The measurement does not fit a governed listing.** At account 3664/hr the listing should run once per 2400 s. The issue counts 36 `pr-list` invocations in 90 s. Either the counted invocations include the Bitbucket sweep's per-branch sub-calls (the issue counted every `plot-host.sh` and `bb` invocation), or something outside `listingSpend` lists. The 15 `pr-state` per 90 s are the `--ask` fallback (`plot-fleet-scan.sh:1340-1357`). That fallback fires for each unjoined branch whenever the cache holds no `.list-complete`, and no cadence rule governs it. The plan's first open question is therefore the precondition for slices 2 and 3, not a side note.
5. **Unit mismatch.** "About 2,500 host calls per hour" counts `plot-host.sh` invocations. `budget.tsv` counts requests, and one Bitbucket sweep invocation costs several requests. A done-condition must use one unit. I recommend requests from `budget.tsv`.
6. **Cause 3 is false for the board and true for the scan.** `fleetPrs` elects under `ReaderLock` (`fleet-clock.ts:244`). `fleetScan` (`fleet-clock.ts:137-155`) does not elect, but the board's scan defers to a live fleetd through `fleetOwnsScan` (`board/src/server/fleet.ts:2720-2727`). That agrees with "boards made 0". No second reader of the scan exists on one machine while fleetd runs. The plan can drop cause 3.

## (b) Approach

- **Slice 1 collides with a rejected plan.** `budget.tsv` lines carry no caller: `b1 connector account bucket at spent limit remaining reset basis` (`plot-budget.sh:434-443`). `2026-09-29-a-spend-line-names-its-caller` proposed a caller field and is Rejected. `cadence.ts` (the `othersPerHour` doc) states that "counting its own lines would need the record to carry a process identity it deliberately does not have". The plan's "the tick attributes those entries to its own run" has no mechanism without that field. The slice must name another mechanism. For example, the scan subprocess reports its own request count per pass on a tagged stderr line, as it already reports `terminal:` and `listing:` (`fleet-scan.ts:563-566`), and `scanOnce` returns that count. Another option is to derive the count, as the cadence does.
- **Slice 3 contradicts a stated design and does not cite it.** `cadence.ts:20-24` says the cadence "bounds the stretch, not the spend" and assigns the reaction to an actual refusal to another slice. `a-daemon-spends-within-its-means` (Released) holds that decision. A hard skip above the limit is a second controller on the same rate. It must state how it composes with `listingSpend` without oscillating, which is the failure `CADENCE_DAMPING` exists to prevent (`cadence.ts:31-49`).
- **Slice 2 is feasible at the adapter.** `plot-host.sh` already takes `pr-list --since` on Bitbucket (`plot-host.sh:201`, `:1207`, `:1358`). The fold rule `rules/scan-listing.ts` is pure domain and has tests, so a Bitbucket arm follows "Every rendered state is a domain property". The CLAUDE.md paragraph on the second consumer ("Bitbucket is unaffected") must change in the same slice, and `AGENTS.md` must be regenerated.

## (c) Slices

- Add a measurement slice first, or make open question 1 a gate on approval. Slices 2 and 3 may target the wrong spender: the `--ask` per-branch `pr-state` fallback and the 720/hr base are both ungoverned by the proposed changes.
- Consider a separate small bug, `the-scan-listing-shares-the-board-s-hour`: price the scan listing's share against 60 s, not 5 s. One constant and one domain test. It removes up to 630 requests/hr on an idle account.
- Slice 3 may be unnecessary for the listing, because `listingSpend` already backs off. If it stays, scope it to the reads that `listingSpend` does not govern: the `--ask` fallback and the merged reads.
- Slice order 1 → 2 → 3 is right for independence. Each slice is mergeable alone.

## (d) Open questions

- Q1 (source of spend): unanswered on main. The code shows two ungoverned paths: `--ask` per branch (`plot-fleet-scan.sh:1357`) and the 720/hr base. Use the method from `2026-10-01-a-shared-account-names-what-spends-it` (wrapped `PATH`, ancestor chain, one hour). Report requests per verb, not invocations.
- Q2 (cause 3): answered. Election covers the PR beat (`fleet-clock.ts:244`). The scan has one owner per machine through `fleetOwnsScan`. Drop cause 3.
- Q3 (which limit): the domain already reads `limit` and `basis` from `spend-rate` (`SpendRate`, `fleet-scan.ts:214-229`). A back-off must use that field, with `unknown` read as "no evidence", never as "free".
- Q4 (`mine=` when a board scans): the board scans only when no fleetd owns the scan (`fleet.ts:2727`). In that case no tick line exists, so the question is moot for `mine=`.
- New: does `mine=` also count the PR reader and the issue reader, which also spend on the clock? The plan's Changelog says `mine=` "counts the scan's calls". The issue expects "every request made on the daemon's behalf".
- New: why does `.list-complete` not hold on the reporting repository? Each missing marker costs one `pr-state` per unjoined branch per 5 s pass.

## (e) Tests per slice (lowest tier)

- **Slice 1:** a fleet unit test in `packages/fleet/test/unit/registryd-main.test.ts`, in the harness at `:1520` (fake scripts, tick lines captured). A stub scan stream reports N requests per pass. The test asserts `mine=` equals `boardSharePerHour` over tick and clock spend. Done when `mine=` equals the stub's count. A test that only checks that `mine=` grew does not prove the slice.
- **Slice 2:** a domain unit in `packages/domain/test/scan-listing.test.ts` for the Bitbucket arm. Cover three cases: a carried OPEN row absent from both answers forces a full read, a branch new to `TRACKED_BRANCHES` forces a full read, and the fold never yields `NONE`. Add a fleet unit in `fleet-scan.test.ts` on the `calls.log` harness (`:199`, `:246`) with a Bitbucket stub: pass 1 makes one full read, and passes 2..N make only `--since` calls. Extend the contract test in `test/reconcile/fleetlisting.test.mjs` with `PLOT_HOST=bitbucket`: zero sweep calls with a carried listing, and identical states. If the shell keeps a duplicate rule, add a corpus test.
- **Slice 3:** a domain unit for the skip rule, next to `listing-spend.test.ts`. Add a fleet unit that asserts zero `plot-host.sh pr-*` calls on a pass over the limit, the last listing carried in `PLOT_PR_LISTING`, and the `--ask` fallback suppressed too.
- **Plan done-condition:** make "an idle fleet costs close to nothing" a number. Proposal: on a fake Bitbucket host with 20 tracked branches, 3 free agents and an empty queue, drive `fleetScan` and `fleetPrs` through 720 simulated 5 s beats with a fake clock in the fleet unit tier. `budget.tsv`, in a private `PLOT_BUDGET_HOME`, then holds at most a stated number of requests (for example 120). The test needs no browser and no real host. Existing budget tests to extend or reuse: `packages/domain/test/{budget,budget-file,budget-buckets,spend-rate,cadence,listing-spend}.test.ts` and `test/reconcile/budget.test.mjs`.

## Amendments

1. Replace "every 60 s" and "the tick's scan" with the 5 s fleet-clock scan, and say that `HostTally` covers only the 60 s tick.
2. Cite `listingSpend`/`scanListingCost` and the released `the-fleet-scan-re-reads-all` (#2734, #2744, #2777) and `a-daemon-spends-within-its-means`. Restate cause 4 as the 720/hr share plus the ungoverned `--ask` per-branch fallback.
3. Drop cause 3 (`fleet-clock.ts:244`, `board/src/server/fleet.ts:2720`).
4. Give slice 1 a mechanism that adds no caller field to `budget.tsv`, and cite the rejected `a-spend-line-names-its-caller`.
5. Make open question 1 a measurement slice or an approval gate, in requests per verb from `budget.tsv`, before slices 2 and 3.
6. State the done-condition as requests per simulated hour on a Bitbucket fixture, at the fleet unit tier, and name the test per slice as in (e).
7. Consider a separate bug for the scan listing's 5 s base share.

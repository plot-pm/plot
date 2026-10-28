# Fleet scan re-sweeps Bitbucket on every 5 s beat after a refused listing and saturates the account; the tick line hides it

> On a Bitbucket repository a refused scan listing never backs off, so fleetd sweeps every tracked branch again on each 5 s beat, and the tick line reports `mine=60/hr` because it counts only the 60 s tick.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-29-1
- **Issue:** #2815
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2817 merged

## Changelog

- A refused or failed scan listing backs off: fleetd stops asking the host for the listing until the back-off ends, keeps scanning with its last listing, and keeps the board bridge fresh, so open boards do not start their own scans.
- The scan's listing slows down when the account reaches its host limit, and an idle fleet's listing takes at most 60 requests per hour instead of 720.
- The supervisor's tick line names the requests per hour of each fleetd loop: the tick, the scan, the PR reader and the issue reader.
- On Bitbucket, the scan reads a delta of changed pull requests after one full sweep, instead of sweeping every tracked branch.

<!-- Board impact: none for the plan format, template, helper scripts or docs/plans layout. `scanOnce` is also the board's fallback scan (packages/board/src/server/fleet.ts:2728), so slices 1, 2 and 4 change the board's fallback scan state too; rebuild the board artifact (pnpm build:board) only to test locally. -->

## Motivation

Issue #2815 reports one machine on Plot 2.29.0 whose Bitbucket account ran at about 4,500 requests/hour against Bitbucket Cloud's about 1,000/hour. Every reader on the machine was throttled: the board banner *Fleet scan blind: the git host refused a burst*, `bb` retries and 429s.

- **Spend.** `~/.plot/state/budget.tsv`, bitbucket `quatico/api`, ten-minute buckets over the last hour: 386, 403, 794, 766, 570, 760.
- **Source.** A 90 s process sample attributed 62 `plot-host.sh` invocations to one fleetd (ewz-kus-portal, Bitbucket): `pr-list` 21, `pr-list --state open` 15, `pr-state` 15, `pr-list --state merged` 11. The boards made 0. In that repository 3 agents were free and the queue was empty. The sample counts processes, not requests: `bb_branch_sweep` (`skills/plot/scripts/plot-host.sh:1260`) forks a subshell per branch that carries the parent's argv, and one Bitbucket sweep costs branches × states requests. `budget.tsv` lines (one per `bb` call) are the unit this plan measures in; the process sample is attribution evidence only.
- **The tick line.** The same fleetd printed `account=3664/hr mine=60/hr`.

Panel round 1 (`.plot/panels/2026-10-28-supervisor-tick-s-fleet-scan-reads/panel.md`) ran the real `scanOnce` against a fake Bitbucket world and probed the cadence rules. It corrects the issue's causes as follows.

1. **The scan runs on the 5 s fleet clock, not on the 60 s tick.** `REFRESH_MS = 5_000` (`packages/fleet/src/shared/fleet-scan.ts:20`), and the `fleet-scan` subscriber takes every beat with an in-flight guard (`packages/fleet/src/shared/fleet-clock.ts:29-37`). The supervisor tick is a separate loop at `TICK_INTERVAL_MS = 60_000` (`packages/fleet/src/server/entry/registryd.ts:81`) and does not call the scan.
2. **A spend stretch already governs the scan's listing.** `scanOnce` asks `listingSpend` before each due listing (`fleet-scan.ts:498-518`). `scanListingCost` prices a Bitbucket listing at 3 requests per tracked branch (`fleet-scan.ts:133-140`), and `cadenceStretch` stretches the interval by the account's observed rate up to `MAX_CADENCE_STRETCH = 8` (`packages/domain/src/rules/cadence.ts:32`). When listings succeed, the panel measured 720 listing requests/hr on a quiet account and 90 to 135/hr at 3,664/hr. The issue's cause 4 ("nothing reads `account=`") is true for the tick only (`registryd-main.ts:2724`, "Reported, never acted on").
3. **A refused or failed listing never backs off.** This is the measured cause. `state.listingAt` moves only when a listing is adopted (`fleet-scan.ts:540,581`). A refused sweep writes no `.list-arrived`, so the next beat is due again (`fleet-scan.ts:498`) and `listingSpend` permits it. `cadence.ts:163-165` states the gap: *"A REFUSAL IS NOT AN INPUT … the reaction to it belongs to the slice that owns refusals."* No such slice exists for the scan. A failed sweep also writes no `.list-complete`, so `host_pr_state --ask` falls back to one `pr-state` per no-ref branch (`skills/plot/scripts/plot-fleet-scan.sh:1346-1357`), which matches the measured `pr-state 15`. Simulated with 15 branches at 3,664/hr: 3 sweeps/hr when sweeps succeed, 48 sweeps/hr (about 2,160 requests) when every sweep after the first is refused and a scan pass takes 40 s, and 362 when it takes 5 s. The same gap exists on GitHub: a failed `readGithubListing` leaves `PLOT_PR_LISTING` empty and the shell sweeps for itself.
4. **The listing's base share uses the 5 s beat.** `listingSpend` receives `intervalMs: REFRESH_MS` (`fleet-scan.ts:505`), so the unstretched share is `boardSharePerHour(5 s × cost, cost)` = 720 requests/hr for any branch count (`cadence.ts:72`). On a Bitbucket account of about 1,000/hr, an idle fleetd's listing may take 72% of the account before any stretch. The board's base is 60 s, which gives 60/hr.
5. **The stretch ignores the account's limit.** `spendRateFor` parses `limit` and `basis` (`fleet-scan.ts:214-232`), but `listingSpend` takes only `Pick<SpendRate, 'perHour'>` (`packages/domain/src/rules/listing-spend.ts:14`), so the stretch stops at 8× whether the account is under or over its limit.
6. **`mine=` counts the tick only.** `minePerHour` is `boardSharePerHour(intervalMs, calls)` (`registryd-main.ts:461`), and `tally.calls` grows only in the tick's own host calls (for example `registryd-main.ts:853,895,937,942`). `mine=60/hr` is one call per 60 s tick. The scan, the PR reader (`fleetPrs`) and the issue reader spend on the clock, outside any tally. `budget.tsv` rows carry no caller by design (`cadence.ts:84-87`), and the Rejected plan `2026-09-29-a-spend-line-names-its-caller` proposed that caller column.
7. **Bitbucket has no delta read.** The carried-listing fold (`packages/domain/src/rules/scan-listing.ts`) serves GitHub only (`fleet-scan.ts:535`), and CLAUDE.md limits that licence to GitHub. A windowed sweep still costs branches × states requests; `bb_window_listing` (`plot-host.sh:1347`) costs one request per state per page, about 4 requests against about 45 for a 15-branch sweep. It prints no whole-window claim (`plot-host.sh:1543-1546,1600-1608`), so `wholePage` (`scan-listing.ts:183`) accepts only an empty delta today.

The issue's cause 3 (no reader election) does not hold: `fleetPrs` elects under `ReaderLock` (`fleet-clock.ts:244`), and a board scans only when no fleetd owns a fresh bridge (`packages/board/src/server/fleet.ts:2720`, `fleetOwnsScan`). The issue measured 0 board calls.

Related released plans: `2026-09-29-a-daemon-spends-within-its-means` (the cadence stretch), `2026-10-26-the-fleet-scan-re-reads-all` (the GitHub carried-listing fold), `2026-10-01-a-shared-account-names-what-spends-it` (the measurement method).

## Design

### Approach

Four slices, merged in this order. Slices 1, 2 and 4 edit `scanOnce`; slice 1 merges first.

**Slice 1 — a refused listing backs off.** A listing that the host refuses (`plot-host.sh` exit 5 `throttled` or exit 6 `secondary`, classified by `pr_list_verdict`, `plot-fleet-scan.sh:698-704,771`) or that fails sets a bounded `backoffUntil` on `ScanState` that grows on repeat and resets on the next adopted listing. The rule is a pure domain function beside `listingSpend` (an input such as `refusedUntil`), in the shape the PR pass already uses (`prGateOpen(state.prNextAt, state.prNextIsBackoff)`, `fleet-clock.ts:256`). While the back-off holds, the scan skips only the host listing: it still runs every beat, hands the shell its carried listing as `PLOT_PR_LISTING`, makes no per-branch `pr-state --ask` call, and still writes the bridge. A back-off that stopped the scan would let the bridge pass `OWNED_BRIDGE_MAX_AGE_MS = 180_000` (`packages/domain/src/rules/scan-owner.ts:10`), and every open board would then start its own live scan. The trigger is the host's refusal and not the account rate, because `budget.tsv` is per machine and cannot see another machine on the same account. The slice covers both backends.

**Slice 2 — the stretch honours the limit.** `listingSpend` and `cadenceStretch` take the account's `SpendRate.limit` and `basis`. With an observed rate at or above a limit of basis `actual` or `predicted`, the listing waits past the cap of 8× until the reported reset or a bounded maximum. A limit of basis `unknown` changes nothing, the rule an absent rate already follows (`cadence.ts:181-189`). The scan passes a 60 s base instead of `REFRESH_MS` to `listingSpend`, so the unstretched share is 60/hr. Domain unit tests assert both rules.

**Slice 3 — the tick line counts each loop.** Each fleetd loop counts its own requests in process: the tick (today's `HostTally`), the scan, the PR reader and the issue reader. The scan's count comes from `scanOnce`'s own host reads plus one tagged stderr line from the shell that reports the requests the shell spent, read the way `listing:` lines are read (`fleet-scan.ts:567-570`). The per-hour arithmetic is a domain rule beside `boardSharePerHour`, over each loop's own interval. The tick line prints one figure per loop. No `budget.tsv` field changes.

**Slice 4 — Bitbucket reads a delta.** After one full read, the scan on Bitbucket asks one unbranched `pr-list --state open --rich` and one `pr-list --state all --since <watermark − 60 s>` through `bb_window_listing`, and folds them onto the carried listing with `foldScanListing`, as GitHub does. The full read stays a branch sweep made by `scanOnce`, at most once per `PR_FULL_READ_MS` (`packages/fleet/src/shared/pr-refresh.ts:342`), with rows that carry `updatedAt`. The tracked set comes from `Refs.listBranches(true)`, declared as a duplicate of the shell's `TRACKED_BRANCHES` (`plot-fleet-scan.sh:766`) with a corpus test. `bb_window_listing` prints a whole-window claim and `NOTICE_PATTERNS` (`packages/domain/src/rules/pr-status.ts:55`) gains its entry; the added shell lines are offset elsewhere under `scripts/check-shell-lines.sh`. An unbranched open listing claims a whole page only below 50 open PRs; above that the fold refuses and the scan makes a full read. `scanListingCost` prices the delta and not the sweep. A carried OPEN row absent from both answers refuses the fold, as on GitHub. The CLAUDE.md paragraph *"A second consumer reads its own last whole answer plus a host delta, on GitHub only"* changes in this slice to name Bitbucket, and `AGENTS.md` is regenerated.

### Done Conditions

Every figure is REST requests per simulated hour on a fake Bitbucket host, counted as `budget.tsv` lines in a private `PLOT_BUDGET_HOME`, at the fleet unit tier with a fake clock: 15 tracked branches, 3 free agents, an empty queue, 720 beats of 5 s.

- **Slice 1:** every listing after the first answers exit 6. Today the scan sweeps 48 to 362 times (about 2,160 to 16,290 requests). After the slice the scan makes at most 8 listing attempts, no `pr-state --ask` call during a back-off, and the bridge `at` is never older than 180 s.
- **Slice 2:** listings succeed on a quiet account. Today the listing spends 720 requests. After the slice it spends at most 60. With an account rate above a `predicted` limit of 1,000, the listing spends 0 requests before the reported reset.
- **Slice 3:** the tick line's per-loop figures equal the fake host's request counts per loop, and their sum equals the `budget.tsv` line count over the same hour.
- **Slice 4:** after one full sweep (45 requests), no listing makes a per-branch request, and each delta costs at most 4 requests.

### Decisions

Decided 2026-10-28 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-28-supervisor-tick-s-fleet-scan-reads/panel.md`):

- [x] A refused or failed scan listing backs off first: a bounded back-off advances on refusal (exit 5/6) and on failure, skips only the host listing, keeps scanning with the carried listing, and keeps writing the bridge.
- [x] The listing stretch honours `SpendRate.limit` in `listingSpend`/`cadence`, and the listing's base share uses a 60 s base instead of the 5 s beat.
- [x] The tick line reports per-loop request counters. It does not attribute `budget.tsv` lines, which carry no caller by design (Rejected plan `2026-09-29-a-spend-line-names-its-caller`).
- [x] Bitbucket reads a delta through `bb_window_listing` with a whole-window claim and a `NOTICE_PATTERNS` entry, paid for in shell lines elsewhere and priced in `scanListingCost`; the CLAUDE.md GitHub-only paragraph changes in that slice.
- [x] The old slice 3 (a back-off on the tick) is dropped: the scan does not run on the tick, and `listingSpend` already stretches the listing by the account's rate.
- [x] Cause 3 (no reader election) is dropped: `fleetPrs` elects (`fleet-clock.ts:244`), boards defer to a live fleetd (`fleetOwnsScan`), and the issue measured 0 board calls.
- [x] The PR-index alternative for the Bitbucket listing is dropped: the scan needs OPEN rows, and *A Decision Reads The Index* allows only MERGED rows from the index.
- [x] Done conditions are REST requests per hour on a fake Bitbucket host with a private `PLOT_BUDGET_HOME`.
- [x] The limit the stretch compares against is `SpendRate.limit` from `plot-host.sh spend-rate`, with no new config key; the back-off triggers on the host's refusal and needs no limit.
- [x] `mine=` for a board-started scan is out of scope: a board scans only when no fleetd owns the scan, and then no tick line exists.

### Open Questions

- [ ] Measure the four spend sources separately over one idle hour, in requests per verb: the scan, the tick (its `mergedBranches` and per-agent `prState`), `refreshPrs`, and the agents' own calls (`worker-loop.ts`). The scan's sweep and `refreshPrs` read the same Bitbucket PRs in one fleetd; the measurement decides whether that duplicate needs its own slice.
- [ ] Two fleetds on one machine share one Bitbucket account (ewz-kus-portal on Bitbucket and websmith on GitHub are named in the issue; two Bitbucket repositories would share the limit). The panel modelled one fleetd only. How do two scans' stretches and back-offs compose against one limit?
- [ ] Bitbucket `.list-complete` and a no-ref squash-merged branch: a complete sweep asks only branches with a remote ref (`plot-fleet-scan.sh:766`) but sets `.list-complete` (`:1263-1273`), and `host_pr_state --ask` then answers `NONE` for a no-ref branch (`:1346-1352`). The safety juror read this hazard but did not reproduce it. Slice 4 keeps the marker for longer; the slice's author reproduces the hazard before the fold lands, and a reproduced hazard gets its own bug slice.
- [ ] What is the maximum age of a carried listing that may still license `NONE`, now that a back-off and the limit can hold a listing longer than 8 × base?

## Slices

### Refusal back-off

- `bug/a-refused-scan-listing-backs-off` — a refused (exit 5/6) or failed listing sets a bounded back-off; the scan keeps running with the carried listing and keeps writing the bridge <!-- builds: a refusal back-off rule beside listingSpend, a backoffUntil on ScanState -->

### Limit-aware stretch

- `bug/the-scan-listing-honours-the-limit` — the listing stretch reads `SpendRate.limit` and `basis`, and the listing's base share uses 60 s <!-- builds: a limit input to listingSpend and cadenceStretch, a 60 s listing base in scanOnce -->

### Per-loop counters

- `bug/the-tick-line-counts-each-loop` — the tick line names the requests per hour of the tick, the scan, the PR reader and the issue reader from in-process counters <!-- builds: per-loop request counters, a domain per-hour rule, a scan spend line on stderr -->

### Bitbucket delta

- `bug/a-bitbucket-scan-reads-a-delta` — fold the carried Bitbucket sweep with a `bb_window_listing` delta that claims its window whole, priced in `scanListingCost`, and amend the CLAUDE.md GitHub-only paragraph <!-- builds: a Bitbucket arm of the carried-listing fold, a whole-window notice -->

## Notes

- Created from tracker issue #2815 by `/plot-idea` on 2026-10-28. Amended after panel round 1 on 2026-10-28. No approval and no implementation exist.
- Related: #2718, #2730, #2782, #2808. Workaround in use on the reporting machine: the ewz-kus-portal fleet is stopped.

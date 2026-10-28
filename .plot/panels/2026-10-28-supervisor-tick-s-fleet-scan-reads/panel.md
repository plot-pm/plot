# Panel moderation: supervisor-tick-s-fleet-scan-reads, round 1

**Reconciliation:** unanimous `amend` (connectors, layering, safety, testability). Every verdict passed `plot-panel.mjs check` on the first send.

## What each juror looked at

| Juror | Ran |
|---|---|
| connectors | the real `scanOnce` bundled with esbuild against a fake Bitbucket world: 15 branches, account at 3,664/hr, one simulated hour, sweeps succeeding versus refused |
| layering | a vitest probe of `listingSpend`, `foldScanListing`, `scanListingWindowFor`; `check-shell-lines.sh --per-file` |
| safety | probes of `listingSpend`, `boardSharePerHour`, `scanListingCost`; 44 domain and 20 fleet tests |
| testability | a script settling `cadence.ts` for branch counts and rates; 90 domain and 20 fleet tests |

All four executed. The connectors simulation reproduces the measured spend.

## Where the jurors agree

1. **The plan names the wrong loop.** The scan runs on the fleet clock's 5 s beat (`fleet-clock.ts:29-37`, `fleet-scan.ts:20`), not on the 60 s tick (`registryd.ts:81`). Slices 1 and 3 target the tick.
2. **A budget stretch already exists.** `scanOnce` calls `listingSpend` with the account rate (`fleet-scan.ts:498-522`); at ≥1,000/hr it stretches 8× (720 → 90/hr for the listing). Cause 4 is false as stated, and slice 3 largely duplicates it.
3. **The real cause: a refused or failed listing never backs off.** `state.listingAt` moves only when a listing is adopted (`fleet-scan.ts:540,578-585`), so after a refusal the scan sweeps again on every beat, and a failed sweep writes no `.list-complete`, so the shell falls back to one `pr-state` per branch (`plot-fleet-scan.sh:1340-1357`) — the measured `pr-state 15`. Simulated: 3 sweeps/hr when they succeed, 48/hr (~2,160 requests) when refused, matching the measured ~2,500/hr (connectors); 720 of 720 beats re-ask cold (safety).
4. **Slice 1 cannot work as written.** `budget.tsv` rows carry no caller on purpose (`cadence.ts:84-88`); `mine=` counts `plot-host.sh` calls of the tick only (today exactly one `mergedBranches` per tick). It needs per-loop request counters, not attribution of `budget.tsv` lines. The Rejected plan `a-spend-line-names-its-caller` proposed the caller column and is not cited.
5. **Slice 2 must use `bb_window_listing`, priced in `scanListingCost`.** A windowed sweep still costs branches × states; `bb_window_listing` costs ~4 requests against ~45 for a 15-branch sweep (connectors). It prints no whole-window claim (`plot-host.sh:1544,1602-1608`), so only an empty delta folds today (layering). The PR-index alternative conflicts with "only terminal rows are read from the index" and goes. The CLAUDE.md paragraph limiting the fold to GitHub changes in the same slice.
6. **Cause 3 goes.** The PR reader elects (`fleet-clock.ts:240-281`) and boards defer to a live fleetd (`fleetOwnsScan`, `fleet.ts:2720`); the issue measured 0 board calls.

## Added by single jurors

- safety: a back-off must skip only the host listing, keep scanning with the carried listing, and keep writing the bridge; past 180 s (`OWNED_BRIDGE_MAX_AGE_MS`) every open board starts its own live scan and multiplies the spend. `budget.tsv` is per machine, so the trigger must include refusals (exit 5/6), not the account rate alone.
- layering: the stretch ignores `SpendRate.limit` and stops at 8×; the fix belongs in `listingSpend`/`cadence`. The tick's own `--state merged`/`pr-state` calls and `refreshPrs` reading the same PRs are separate sources the first open question must measure apart.
- testability: the scan listing's base share uses a 5 s base (720/hr, 72% of a ~1,000/hr Bitbucket account for an idle fleetd); a 60 s base is one constant and one domain test.
- safety: a hazard read, not reproduced: on Bitbucket, a complete sweep sets `.list-complete` but asks only branches with a remote ref, so the `--ask` arm answers `NONE` for a no-ref squash-merged branch (`plot-fleet-scan.sh:766,1263-1271,1346-1352`).

## Shared blind spot

All four modelled one fleetd on one machine. The issue names two repositories' supervisors (ewz-kus-portal on Bitbucket and websmith on GitHub) on one machine and one Bitbucket account; none modelled two fleetds sharing an account's limit.

## Amendments the panel asks for

- Rewrite the causes: the 5 s clock, the existing stretch, the refusal that never backs off; drop cause 3.
- Slices: a refusal back-off first (bounded, skips only the listing, keeps the bridge); the stretch honours the limit and, if agreed, a 60 s base; per-loop request counters for the tick line; a Bitbucket delta through `bb_window_listing` with a whole-window claim, priced; drop slice 3.
- Done-conditions in requests per hour on a fake Bitbucket host with a private `PLOT_BUDGET_HOME`.

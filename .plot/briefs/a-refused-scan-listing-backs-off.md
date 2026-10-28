## Implementation brief — supervisor-tick-s-fleet-scan-reads (wave 1: Refusal back-off)

- **Plan (canonical):** `docs/plans/2026-10-28-supervisor-tick-s-fleet-scan-reads.md` on `main`
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2817 merged
- **Branch:** `bug/a-refused-scan-listing-backs-off` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave is first of four and waits on nothing. Waves 2 (`bug/the-scan-listing-honours-the-limit`) and 4 (`bug/a-bitbucket-scan-reads-a-delta`) edit `scanOnce` too, so they wait on this one. Wave 3 (`bug/the-tick-line-counts-each-loop`) is independent of the scan's cadence code. Issue: #2815.

### What to build

A scan listing that the host refuses or that fails never backs off, so fleetd lists again on every 5 s beat. Measured on `ewz-kus-portal` (Bitbucket): `budget.tsv` ran 386 to 794 requests per ten minutes against a limit of about 1,000/hr, and one fleetd made 62 `plot-host.sh` calls in 90 s (`pr-list` 21, `pr-list --state open` 15, `pr-state` 15). Simulated with 15 tracked branches: 3 sweeps/hr when sweeps succeed, 48 when every sweep after the first is refused and a pass takes 40 s, 362 when it takes 5 s.

The cause is in `scanOnce` (`packages/fleet/src/shared/fleet-scan.ts:489`). `state.listingAt` moves only where a listing is adopted (`:540`, `:581`), so a refused listing leaves `due` true (`:498`) on the next beat, and `listingSpend` permits it. `cadence.ts:163-165` says *"a refusal is not an input … the reaction belongs to the slice that owns refusals"*. This is that slice, for the scan.

Build two things:

1. **A pure domain rule beside `listingSpend`** (`packages/domain/src/rules/listing-spend.ts`) that takes a refused-until input and answers whether the listing may be spent. The back-off is bounded, grows on a repeated refusal and resets on the next adopted listing. Shape it like the PR pass's gate: `prGateOpen(state.prNextAt, state.prNextIsBackoff)` at `packages/fleet/src/shared/fleet-clock.ts:256`.
2. **A `backoffUntil` on `ScanState`**, set by `scanOnce`. The trigger is the host's refusal (`plot-host.sh` exit 5 `throttled` or exit 6 `secondary`, classified by `pr_list_verdict`, `skills/plot/scripts/plot-fleet-scan.sh:698-704`) and any other failure of a spend pass. It is both backends: a failed `readGithubListing` on GitHub, and on Bitbucket the shell's own sweep, whose verdict reaches `scanOnce` in `reading.summary.host` and by the missing `.list-arrived` line (`listingEnded`, `fleet-scan.ts:179`). Read both and check which one a refused Bitbucket sweep actually leaves; do not assume.

While the back-off holds, skip only the host listing. The scan still runs on every beat, hands the shell its carried listing as `PLOT_PR_LISTING`, and `writeScan` still writes the bridge. Fix the `ScanState` doc comment and the `scanOnce` TSDoc to state this.

### Decisions the plan settles — do not re-derive them

**The scan does not run on the 60 s tick.** The issue assumed it did. `REFRESH_MS = 5_000` (`fleet-scan.ts:20`) and the `fleet-scan` subscriber takes every beat (`fleet-clock.ts:29-37`); the tick is a separate loop at `TICK_INTERVAL_MS = 60_000` (`registryd.ts:81`). A back-off on the tick was the old slice 3 and is dropped.

**The back-off must not stop the scan.** A scan that stopped would let the bridge pass `OWNED_BRIDGE_MAX_AGE_MS = 180_000` (`packages/domain/src/rules/scan-owner.ts:10`), and every open board would then start its own scan (`fleetOwnsScan`, `packages/board/src/server/fleet.ts:2720`) — the saturation moved to another process. Done condition: the bridge `at` is never older than 180 s during a back-off.

**The trigger is the host's refusal, not the account rate.** `budget.tsv` is per machine and cannot see another machine on the same account. The account-rate reaction is wave 2.

**No `pr-state --ask` call during a back-off.** A failed sweep writes no `.list-complete`, so `host_pr_state --ask` falls back to one `pr-state` per no-ref branch (`plot-fleet-scan.sh:1346-1357`) — that is the measured `pr-state 15`. `carried_listing` (`:893`) refuses a value with no `.list-arrived` line and writes `.list-complete` only where the carried value holds it. So handing the shell a carried listing that arrived and was complete silences both the sweep and the per-branch asks. Do not hand it one that lacks either marker.

**Rules carried over unchanged.** Absent is not empty: an empty `state.listing` is never handed over as a listing, and never licenses `NONE` (the 2026-08-27 failure that refused four fully-merged plans). The index never says no. The scan hands `PLOT_PR_LISTING` and never `PLOT_SCAN_ASK_ALWAYS`, which may only restore asking.

**Edge the plan does not close — report it, do not improvise.** If the first listing is the one refused, `state.listing` is empty during the back-off, so there is nothing to carry and the shell sweeps for itself on every beat. The done condition assumes the first listing succeeds ("every listing after the first"). Write a test for the first-listing-refused case and report what it measures; if the fix needs a shell change or a new env variable, that is the plan's author to decide.

### Done when

The plan's slice 1 done condition is the specification: on a fake Bitbucket host (15 tracked branches, 3 free agents, empty queue, 720 beats of 5 s, fake clock, private `PLOT_BUDGET_HOME`), every listing after the first answers exit 6. Today the scan sweeps 48 to 362 times (about 2,160 to 16,290 requests). After this slice:

- the scan makes at most 8 listing attempts,
- it makes no `pr-state --ask` call during a back-off,
- the bridge `at` is never older than 180 s.

Assertions that exist because a naive implementation would pass without them:

- **Count `budget.tsv` lines, not calls to the rule.** A back-off that gates `listingSpend` but not the shell's sweep passes a rule test and still spends. This catches a back-off on the wrong side of `PLOT_PR_LISTING`.
- **Run both scan times, 5 s and 40 s.** The two measured figures (362 and 48) differ by a factor of 7.5; a rule tuned to one passes the other by accident.
- **Assert the bridge age across the whole back-off.** This catches a back-off that returns early from `scanOnce` before `writeScan`.
- **A success after a refusal resets the back-off**, and the next refusal starts from the base again. This catches a back-off that only grows.
- **The same two cases on GitHub** (`readGithubListing` returns null). The gap exists there too.
- **A domain unit test for the rule**, apart from the fleet test: the bound, the growth, the reset.

Plus: add a changeset (package `plot`; the description first and the `bumps:` block last, with `plan:` in the block — `./scripts/check-changeset-packages.sh` refuses the other order). The domain package takes arrow functions, TSDoc that states behaviour and no history, and no `Wave`/`Worker` vocabulary where `Slice`/`Agent` is meant.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite, and do not run `pnpm run test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should not need a `.sh` change. If it does, pay for the growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/fleet/src/shared/fleet-scan.ts`, `packages/domain/src/rules/listing-spend.ts` (and `cadence.ts` only if the rule needs a shared constant), their tests under `packages/fleet/test/unit/` and `packages/domain/`, and the changeset.

Not this branch: the limit input to `listingSpend` and the 60 s base (wave 2), per-loop counters and the tick line (wave 3), the Bitbucket delta, `bb_window_listing` and the CLAUDE.md paragraph (wave 4). Do not read `SpendRate.limit` here. `scanOnce` is also the board's fallback scan (`packages/board/src/server/fleet.ts:2728`), so the board's fallback scan state changes with this slice; rebuild the board artifact only to test locally and restore generated paths before the push.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

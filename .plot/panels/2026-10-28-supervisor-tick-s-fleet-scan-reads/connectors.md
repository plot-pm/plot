# Juror verdict: connectors and request budget

Position: amend

Evidence: Read the plan, issue #2815 (`gh issue view`), `packages/fleet/src/shared/fleet-scan.ts`, `packages/fleet/src/shared/fleet-clock.ts`, `packages/fleet/src/server/entry/registryd-main.ts` (tally, `spendForTick`, `mergedBranches`), `packages/domain/src/rules/listing-spend.ts`, `packages/domain/src/rules/cadence.ts`, `packages/domain/src/entities/budget.ts`, `skills/plot/scripts/plot-fleet-scan.sh` (`carried_listing`, `prefill_pr_states`, `host_pr_state`), and `skills/plot/scripts/plot-host.sh` (`bb()`, `bb_branch_sweep`, `bb_window_listing`, `bb_states_for`, `pr_sweep_report`). Read `~/.plot/state/budget.tsv` on this machine (format and per-key counts only). RAN: an esbuild bundle of the real `scanOnce` (worktree source) driven by a fake `ScanWorld` on backend `bitbucket`, 15 tracked branches, a simulated hour on a 5 s beat (bundle at `/private/tmp/claude-501/-Users-jwloka-Quatico-Agentic-Tools-plot/ca0ab00d-98d3-4ca8-8a1b-8a43a4eda657/scratchpad/juror-2815-connectors/sim.mjs`). No host was asked; no `bb`, `gh` write, board or fleet command ran.

## (a) Problem statement

1. **The scan does not run in the 60 s tick.** The plan and the issue both say "each 60 s tick runs `plot-fleet-scan.sh --stream`". The scan runs on the fleet clock, on every 5 s beat, guarded only against overlap: `fleet-clock.ts:29-37` (`'fleet-scan'` at `divisorFor(base, REFRESH_MS)`), `fleet-scan.ts:20` (`REFRESH_MS = 5_000`), `fleet-clock.ts:137-153` (`fleetScan` → `scanOnce`). The tick (`TICK_INTERVAL_MS`, `registryd-main.ts:292`) does not call the scan. Slice 3's "the tick skips its host read" therefore names the wrong loop.

2. **The scan is already gated by spend, on Bitbucket too.** `scanOnce` asks `listingSpend` before every listing (`fleet-scan.ts:498-522`), priced by `scanListingCost` at `branches × 3` on Bitbucket (`fleet-scan.ts:133-140`) and stretched from the account's `spend-rate` up to `MAX_CADENCE_STRETCH = 8` (`cadence.ts:31`). A reused listing reaches the shell as `PLOT_PR_LISTING`, and `carried_listing` short-circuits the sweep (`plot-fleet-scan.sh:893-939, 993`). Cause 1 ("the scan reads live") is therefore not true as stated. The measured spend needs a different cause.

3. **The missing cause: a refused or failed listing never advances the cadence.** `state.listingAt` is written only when a listing is adopted (`fleet-scan.ts:540, 581`). A sweep that the host refuses prints no `.list-arrived`, so nothing is adopted, `listingAt` stays at the last success, and every following beat reads `due` and spends again (`fleet-scan.ts:498`). `cadence.ts` states this gap itself: "A REFUSAL IS NOT AN INPUT … the reaction to it belongs to the slice that owns refusals" (`cadence.ts` comment above `cadenceStretch`). No such slice exists for the scan. The board banner in the issue (*Fleet scan blind: the git host refused a burst*) shows that the sweeps were being refused. Simulated over one hour, 15 branches, account at 3,664/hr:

   | scenario | sweeps/hr | sweep requests/hr (≤ 3 × 15 each) |
   |---|---|---|
   | quiet account, every sweep succeeds | 16 | 720 |
   | 3,664/hr, every sweep succeeds | 3 | 135 |
   | 3,664/hr, first sweep ok, then every sweep refused, scan 5 s | 362 | ≤ 16,290 |
   | 3,664/hr, first sweep ok, then refused, scan 40 s | 48 | ≤ 2,160 |

   The last row matches the measured ~2,500/hr. The existing stretch works when sweeps succeed, and it does nothing when they fail. A failed sweep also withholds `.list-complete`, so `host_pr_state --ask` falls back to one `pr-state` per branch (`plot-fleet-scan.sh:1337-1368`). That fallback explains the measured `pr-state 15` per 90 s. The same gap exists on GitHub: a failed `readGithubListing` leaves `PLOT_PR_LISTING` empty (`fleet-scan.ts:535-543, 563`), and the shell then sweeps for itself. The websmith row in the issue (`pr-state 35`, `pr-merged 35`) is consistent with this.

4. **The scan's base share is 720/hr, not 60/hr.** `listingSpend` is called with `intervalMs: REFRESH_MS` (5 s, `fleet-scan.ts:503`). The share is `boardSharePerHour(5 s × cost, cost)` = 720 requests/hr whatever the cost (`cadence.ts:72, targetStretch`). Against Bitbucket's predicted 1,000/hr (`budget.tsv` rows on this machine read `limit=1000 basis=predicted`), one idle fleet's scan alone is entitled to 72% of the account before any stretch. The plan should state this number and decide whether the scan's listing base belongs at `PR_REFRESH_MS` (60 s).

5. **`mine=` undercounts more than the scan.** Confirmed: `minePerHour = boardSharePerHour(intervalMs, tally.calls)` (`registryd-main.ts:461`), and only the tick's own ports increment `tally` (`registryd-main.ts:559, 853, 895, 937-942`). The PR reader (`fleetPrs`, `fleet-clock.ts:228`), the issue reader and the default-branch reader also spend outside `tally`. `mine=60/hr` is exactly one call per 60 s tick: the `mergedBranches` delta call (`registryd-main.ts:894`).

6. **The process sample counts processes, not requests.** `plot-host.sh` runs each branch query inside a command substitution (`bb_branch_sweep`, `plot-host.sh:1260-1300`). A forked subshell carries the parent's argv, so a `ps` sampler that counts PIDs can count one `pr-list` invocation many times. `--state merged` does not appear in the scan at all: the scan asks `--state settled` (`plot-fleet-scan.sh:1063`), and `--state merged` comes from `mergedBranches` (`registryd-main.ts:857, 894`). The plan should use `budget.tsv` lines (one line per `bb` call, `plot-host.sh:3909`) as the unit, and keep the process sample as attribution only.

7. **Cause 3 (no reader election) does not apply to the scan.** `fleetPrs` elects under `ReaderLock` (`fleet-clock.ts:240-247`). The scan's listing is outside that election, but only one fleetd scans a repository, and the issue measured 0 calls from boards. The scan is not a second reader that competes with an elected one.

## (b) Approach

- **Slice 1 (`mine=` counts the scan): the mechanism contradicts a deliberate design.** `budget.tsv` has no process or caller column (`budget.ts:178-195`, ten fields), and `cadence.ts:85-88` says that attribution "would need the record to carry a process identity it deliberately does not have". "The tick attributes those entries to its own run" cannot be built on the record as it is. Two working routes: (i) the caller sets an env var, for example `PLOT_SPEND_TALLY=<file>`, and `budget_record_call` (`plot-host.sh:3658`) appends one byte per recorded call to that file as well; or (ii) the scan reports its spend on stderr, the way it already reports `.branches` (`plot-fleet-scan.sh:962-964`), and `scanOnce` returns it. A new budget-row format (`b2`) is a larger change, and every `decodeEntry` reader would refuse it. The slice must also cover the PR, issue and default-branch readers, or name the field `mine=tick`, not `mine=`.
- **Slice 2 (Bitbucket delta) fixes a real cost but not the measured one.** The adapter already has the windowed read: `bb_window_listing` (`plot-host.sh:1347`) asks `q=state=… AND updated_on>=…` at `pagelen=50`, one request per state. A windowed SWEEP (`bb_branch_query` with `PR_LIST_SINCE`) still costs branches × states requests, so the slice must use the windowed listing, not the windowed sweep. With that route, a Bitbucket delta costs about 4 requests (`--state open --rich` once, then `--state all --since` = 3 states) against 45 for a 15-branch sweep. The full read (the sweep, or `bb_state_listing` paged to the limit) runs at most once per `PR_FULL_READ_MS`. `scanListingCost` must price the delta and not the sweep (`fleet-scan.ts:133-140`). Otherwise `listingSpend` stretches against a cost the scan no longer pays. CLAUDE.md's GitHub-only licence paragraph ("A second consumer reads its own last whole answer plus a host delta, on GitHub only") must be amended in the same slice. The paragraph scopes the licence to one backend by name.
- **Do not read the PR index for this.** The plan's alternative ("let the shell take the listing from the PR index") collides with "A Decision Reads The Index": the index never says `pr: 'none'`, and the scan's whole reason to list is to license `NONE` (`.list-complete`) for tracked branches without a PR. The scan's own carried base is the licensed route.
- **Slice 3 (back off over budget) mostly duplicates `listingSpend`.** The stretch from `account=` exists (point a.2). It works when sweeps succeed (135/hr in the simulation). What is missing is a reaction to a refusal: after a failed or partial listing, set a next-allowed time with growing backoff, honour `plot-host.sh` exit 5/6 (`throttled`, `secondary`, `plot-fleet-scan.sh:700-706`), and do not reprice. `pr-refresh.ts` already holds this shape (`prNextAt`, `prNextIsBackoff`, `prGateOpen`, used at `fleet-clock.ts:250`). The rule belongs in the domain next to `listingSpend`, as an input such as `lastFailedAt` or `refusedUntil`, so a unit test can assert it.
- **Layering.** All three changes stay inside the existing layers: the rule in `packages/domain/src/rules`, the call in `fleet-scan.ts`, and the request in `plot-host.sh`. No change needs a new spawn site.

## (c) Slices

1. **Add first, as its own bug: `bug/a-refused-scan-listing-backs-off`.** A failed, refused or partial listing advances the scan's next-listing time with backoff, on both backends. This slice removes the measured spend. Without it, slices 2 and 3 do not change the failing case: a refused windowed read is retried every beat as well.
2. `bug/the-tick-line-counts-its-scan`: keep, with the env-tally mechanism and the other three readers in scope.
3. `bug/a-bitbucket-scan-reads-a-delta`: keep, through `bb_window_listing`, with `scanListingCost` repriced and the CLAUDE.md paragraph amended.
4. `bug/a-tick-over-the-limit-backs-off`: drop, or fold into slice 1 above. Optionally replace it with a narrower question: should the scan's listing base be `PR_REFRESH_MS`, not `REFRESH_MS`? That one-constant change cuts the base share from 720/hr to 60/hr.

Each slice touches different files except `fleet-scan.ts`. The backoff slice and the delta slice both edit `scanOnce`, so merge the backoff slice first.

## (d) Open questions

- *Sweep, `pr-state`, or both?* Both, and they share one cause: the `pr-state` calls are the N+1 fallback that runs when a sweep fails to produce `.list-complete` (`plot-fleet-scan.sh:1337-1368`). Measure by `budget.tsv` line count per 10 minutes while the fleet runs, together with the scan's `HOST_VERDICT`. A process count is not a request count.
- *Is cause 3 true?* No, for the scan. `fleetPrs` elects (`fleet-clock.ts:240`). The scan is one per fleetd and is not a competing reader. Drop it.
- *Which limit?* `spend-rate` already returns `limit` and `basis` (`fleet-scan.ts:198-232`). On Bitbucket the record carries `1000` with `basis=predicted` (local `budget.tsv`). The refusal backoff should not need the limit at all: exit 5/6 is the host's own answer.
- *Does `mine=` count when a board starts the scan?* The issue measured 0 board calls. Whether a board still runs `scanOnce` with no fleetd was not traced here. The plan should check that before it widens the counter.
- **New question:** Is the 5 s base for the scan's listing intended? It gives the scan 12 times the board's 60/hr share (`cadence.ts:60-73`).
- **New question:** Does the backoff hold `PLOT_PR_LISTING` to the last good listing while it waits, and does the board show the listing's age? `listingReusedAgeMs` exists (`fleet-scan.ts:524`). A carried listing past `PR_FULL_READ_MS` should not license `NONE`.

## (e) Tests

- **Refusal backoff:** a domain unit test on the extended `listingSpend` (a refused listing at T means no spend before T + backoff, and the backoff grows on repeat). A fleet unit test in `packages/fleet/test/unit/fleet-scan.test.ts` that drives `scanOnce` with a stream that emits no `.list-arrived` after the first scan, as `sim.mjs` above does, and asserts at most a handful of empty `PLOT_PR_LISTING` hand-offs per simulated hour. Today that count is 362.
- **`mine=`:** a contract test in `test/reconcile/` showing that `plot-host.sh` with `PLOT_SPEND_TALLY` set appends once per `budget_record_call`, and a fleet unit test showing that `spendForTick` sums the tally of the scan and the readers.
- **Bitbucket delta:** a `host.test.mjs` case with the stub `bb` showing `pr-list --state all --since` routing to `bb_window_listing` (one `bb api` per state, not one per branch). A fleet unit test with `backend: 'bitbucket'` showing that a due listing is read before the scan and handed over non-empty. A `scanListingCost` unit test that prices the delta.
- No browser test is needed: no rendered state changes.

## Amendments

1. Correct the Motivation: the scan runs on the 5 s fleet clock (`fleet-clock.ts:29-37`), not in the 60 s tick, and it is already spend-gated by `listingSpend` (`fleet-scan.ts:498-522`).
2. Add the missing cause and its slice first: a refused or failed listing does not advance `listingAt`, so the scan re-sweeps on every beat (simulated: 48 to 362 sweeps/hr). Ship it as its own bug ahead of the others.
3. Slice 1: replace "attribute `budget.tsv` entries" with an env-scoped tally from `plot-host.sh`, or a stderr spend report from the scan. Include the PR, issue and default-branch readers.
4. Slice 2: name `bb_window_listing`, not a windowed sweep. Reprice `scanListingCost`. Amend the CLAUDE.md "on GitHub only" paragraph. Remove the PR-index alternative.
5. Slice 3: drop it or merge it into amendment 2. Raise the `REFRESH_MS` versus `PR_REFRESH_MS` base-share question as an open question.
6. State the measurement unit as `budget.tsv` lines, and treat the 90 s process sample as attribution evidence only.

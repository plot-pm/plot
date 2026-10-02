# Delivery reads the last finished scan

> The Deliver route judges a plan against the pulse the board holds at the moment of the request. While a streaming scan runs, that pulse is partial, and the route answers `scan-incomplete`. The scan runs most of the time, so a fully merged plan can be refused for twenty minutes while `/api/fleet`, read between two scans, reports the scan complete.

## Status

- **State:** Approved
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Issue:** #1113
- **Sprint:** the-fleet-runs-through-its-limits
- **Review:** in-session
- **Impl:** own branches
- **Started:** 2026-10-02, Jan Wloka, `bug/delivery-reads-the-last-finished-scan`

## Changelog

- `POST /api/deliver` and the board's Deliver verdict judge a plan against the last scan that finished, not against the scan in progress. A fully merged plan is deliverable while the next scan runs.
- `scan-incomplete` means that no scan has finished since the board started, or that the plan names a branch the last finished scan did not report.

Board impact: the Deliver control on a plan card stops flickering between deliverable and *waiting for the scan* on every pulse.

## Motivation

Measured 2026-09-30 (#1113): #1109 merged at 18:12Z, and `/api/fleet` showed its branch `state: merged`, `verdict: complete`, `complete: true`, `ageSeconds: 11`. `POST /api/deliver {"slug":"a-plan-row-says-its-verdict-once"}` answered 409 `scan-incomplete` on each of 20 calls, one a minute.

**Both routes read one cache entry, at different moments.** The issue suspected two cache entries. On `origin/main` they share one: the write route passes `{ ...opts, host, port }` (`packages/board/src/server/index.ts:402`), and the cache key is `repoRoot` and `scriptsDir` only (`fleet.ts:934-936`). What differs is the time of the read:

- A refresh streams the scan. On the first plan line it publishes a composed partial pulse and sets `entry.pulseComplete = false` (`publishPartial`, `fleet.ts:3270-3285`). It sets `pulseComplete = true` only after the terminal line (`fleet.ts:3367`).
- `deliverability` (`deliver.ts:206`) calls `allSlicesMerged(meta, pulseFor(opts), pulseCompleteFor(opts))` (`deliver.ts:230`). `allSlicesMerged` returns `unknown` whenever `complete` is false (`packages/domain/src/rules/deliverable.ts`, first line of the function), and the route maps `unknown` to `scan-incomplete` (`deliver.ts:233-234`).
- `/api/fleet` reports `complete: entry.pulseComplete` (`fleet.ts:7883`) when the client polls it. A poll that lands between two scans reads `true`.

A scan takes 18 to 37 s (#1017) on a 5 s cadence, so the pulse is partial for most of every minute. A request at a random moment is refused with that probability, and a person or the auto-deliver tick that asks once a minute is refused again and again.

**The board's Deliver verdict has the same defect.** `board.ts:1913` reads `pulseCompleteFor(opts)` and passes it to `planStatus` (`board.ts:2002`), so a card reads *not deliverable yet* during every scan.

**The last finished pulse already exists, and is then thrown away.** `refresh` keeps it as `before` (`fleet.ts:3173`) only to compute `pulseShrink`; `publishPartial` then overwrites `entry.pulse`.

## Design

**The cache entry keeps the last finished pulse** as `entry.lastComplete`, set beside `entry.pulseComplete = true` (`fleet.ts:3367`) and never by `publishPartial`. The bridge read in `ensureCache` sets it when the bridged pulse was complete.

**A domain rule decides which pulse may judge a delivery.** `rules/deliverable.ts` gains `deliveryPulse(meta, live, liveComplete, lastComplete)`:

- the live pulse, where it is complete;
- else the last complete pulse, where one exists and its plan entry names every non-deferred branch the plan file names now;
- else `null`, which `allSlicesMerged` already reads as `unknown`.

The branch check is what makes an older pulse safe to use. A merged branch cannot unmerge, so a finished pulse that reported every slice `complete` stays true. A plan that gained a slice after that pulse names a branch the pulse never reported, and the rule falls back to `unknown` instead of reading the new slice as done. Unit tests cover each arm at the domain's 100% branch coverage.

**Both callers ask the rule.** `deliverability` (`deliver.ts:230`) and the card verdict (`board.ts:1913-2002`) pass the pulse the rule chooses and `complete: true` where it chose one. Neither reads `pulseCompleteFor` for a delivery decision any more.

**Coordination with #1139.** `docs/plans/2026-10-01-a-merge-subject-proves-a-landing-the-host-cannot.md` changes the rule `deliver.ts:230` calls, from `allSlicesMerged` to `allSlicesConfirmed`. This plan changes the pulse that call receives. The two edits touch one line; whichever branch merges second rebases onto the first and keeps both.

## What this does NOT do

- It does not change the scan, its cadence, or the streaming display. A partial pulse still renders, labelled as partial.
- It does not change `plot-deliver.sh` or the host re-gate behind it (`controllers/deliverability.ts`). A delivery the board offers is still re-verified against the host before anything is written.
- It does not change auto-delivery's retry behaviour. #1139's plan owns the `inFlight` path.

## Done when

- `deliveryPulse` exists in `rules/deliverable.ts` with unit cases: live complete; live partial with a last complete pulse that covers the plan; live partial with a last complete pulse missing one of the plan's branches; live partial with none; a deferred branch absent from the last pulse does not force `unknown`.
- A board unit test drives a refresh with a fake streaming scan, pauses it after the first plan line, and asserts that `deliverability` answers `deliverable` for a plan whose branches all merged in the previous finished pulse, and `scan-incomplete` for a plan that names a branch that pulse lacks.
- The same test asserts that the card verdict reads deliverable during the paused scan.
- `pnpm test`, `pnpm run test:board`, `pnpm run typecheck` pass; domain coverage stays at 100%. A `'@plot-pm/board': patch` changeset.

## Slices

### Delivery reads the last finished scan (Branch: bug/delivery-reads-the-last-finished-scan)

`entry.lastComplete`, the `deliveryPulse` rule, both callers, the tests. <!-- builds: deliveryPulse, the rule that picks the pulse a delivery is judged against -->

## Notes

The deliverable search for *lastCompletePulse* and *pulseCoversPlan* found nothing by either name. The issue's hypothesis of two cache entries is not what `origin/main` shows; the measured symptom matches a single entry read mid-scan.

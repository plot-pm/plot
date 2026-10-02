## Implementation brief — delivery-reads-the-last-finished-scan

- **Plan (canonical):** `docs/plans/2026-10-01-delivery-reads-the-last-finished-scan.md` on main
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/delivery-reads-the-last-finished-scan` (base: `main`)
- **Ends as:** one PR to main, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** the repo's PR review; the plan's `Review:` is `in-session`

The plan has one slice. Nothing waits on it and it waits on nothing.

### What to build

The Deliver route and the card's Deliver verdict judge a plan against the pulse the cache holds at the moment of the read. During a streaming scan that pulse is partial, so both answer `scan-incomplete`. Measured 2026-09-30 (#1113): #1109 merged, `/api/fleet` reported its branch `complete`, and `POST /api/deliver` answered 409 `scan-incomplete` on 20 of 20 calls, one a minute. A scan takes 18 to 37 s on a 5 s cadence, so the pulse is partial for most of every minute.

The fix has three parts:

1. `CacheEntry` in `packages/board/src/server/fleet.ts` gains `lastComplete: FleetReading | null`. It is set beside `entry.pulseComplete = true` (the success path after the terminal line, `fleet.ts:3368`) and in the bridge read of `ensureCache` (`fleet.ts:3587`), and nowhere else. `publishPartial` never sets it. `freshCacheEntry` (`fleet.ts:3555`) starts it at `null`.
2. `rules/deliverable.ts` in the domain gains `deliveryPulse(meta, live, liveComplete, lastComplete)`. It returns the live pulse where `liveComplete` is true; else `lastComplete` where that pulse's entry for the plan names every non-deferred branch the plan file names now; else `null`. `allSlicesConfirmed` already reads a `null` pulse as `unknown`.
3. Both callers ask the rule: `deliverability` (`packages/board/src/server/deliver.ts:237`) and the card verdict (`packages/board/src/server/board.ts:1913` and `:2002`). They pass the chosen pulse with `complete: true` where the rule chose one. Neither reads `pulseCompleteFor` for a delivery decision after this change.

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**There is one cache entry, not two.** The issue (#1113) suspected the read route and the write route held separate entries. They do not: the cache key is `repoRoot` and `scriptsDir` only (`fleet.ts:934-936`), and the write route passes `{ ...opts, host, port }`. The defect is the TIME of the read. Do not add a second entry or change the key.

**A finished pulse may judge a delivery because a merged branch cannot unmerge.** A last-complete pulse that reported every slice `complete` stays true. The one way it goes stale is a plan that gained a slice since: the pulse never reported that branch. That is why the rule checks the plan's branches against the pulse and returns `null` on a miss. Without that check a freshly added slice reads as done. Do not drop it to "simplify" the rule.

**Deferred branches do not force `unknown`.** A deferred branch the last pulse omits is exempt, matching `allSlicesMerged`'s own rule. The fifth unit case in the plan pins this.

**`lastComplete` is set only where a scan finished.** `publishPartial` overwrites `entry.pulse` with a composed partial pulse, and `refresh` keeps the previous pulse as `before` (`fleet.ts:3174`) only for `pulseShrink`. `before` is `null` unless `pulseComplete` was true, so it is not a substitute: reuse its shape, not the variable. A scan killed at the 30 s timeout publishes a partial pulse and must leave `lastComplete` as it was.

**Cold start.** On a cold cache `pulseComplete` defaults to `true` with a `null` pulse (`pulseCompleteFor`'s own doc comment says so). The rule must treat `live: null` as not usable whatever `liveComplete` says, and `lastComplete: null` as nothing: the result is `null`, then `unknown`, then `scan-incomplete`. That is the meaning the plan's changelog gives `scan-incomplete`: no scan has finished since the board started.

**Reads stay in the controller's layer, the decision in the domain.** The rule takes values and reads no cache. `deliverable.ts` imports only `FleetReading` from entities; keep it that way.

**The re-gate behind the board is unchanged.** `/plot-deliver` still asks the host before anything is written (`controllers/deliverability.ts`). The board offering a delivery from an older finished pulse costs at most one refused re-gate. Do not touch `plot-deliver.sh`.

**Rules carried over unchanged from related work.** Absent is not false: a plan missing from a finished pulse is `not-merged`, a plan missing from a partial pulse is `unknown`, and the rule must keep those two apart. Read the answer, not its emptiness: `null` from `deliveryPulse` is an answer ("nothing may judge this"), not a missing value.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive implementation would pass without them:

- **The "plan gained a slice" case.** A last-complete pulse where the plan's entry lacks one of the plan file's non-deferred branches must give `scan-incomplete`. A naive rule that returns `lastComplete` whenever live is partial passes every other case and fails this one.
- **The deferred-branch case.** A deferred branch absent from the last pulse must not force `unknown`. It catches an over-strict branch check.
- **The paused-scan test drives `refresh` with a fake streaming scan.** Pause it after the first plan line, so `entry.pulseComplete` is `false` and `entry.pulse` is the composed partial pulse. Then assert both `deliverability` and the card verdict. A test that sets `pulseComplete` by hand skips `publishPartial` and cannot catch a `lastComplete` written in the wrong place.
- **The card assertion.** The same paused state must show the card as deliverable (`status === 'deliverable'`, `board.ts:2003`). It catches a fix applied to the route only.
- **A scan that fails mid-stream leaves `lastComplete` unchanged.** Add this case beside the paused-scan test; it is the guard on "set only on success".

Plus: `pnpm test`, `pnpm run test:board`, `pnpm run typecheck`, domain coverage at 100% (every arm of `deliveryPulse` has a case), and a changeset with `'@plot-pm/board': patch` and the description first, no `bumps:` block (a board change names no skill). Run `nvm use` first; pnpm crashes on Node 26. Do not run `test:e2e` locally. Run `pnpm build:board` before `test:board`, and commit the rebuilt `board-server.mjs`. On a conflict in that file take either side and rebuild.

The domain package uses arrow functions and factual TSDoc (what it does, parameters, return, failure). Put the measurement (#1113, 20 of 20 refusals) in the commit message, not in the doc comment.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Append `→ #<number>` to this branch's heading line under `## Slices` in the plan when the PR exists. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/deliverable.ts` and its test (`packages/domain/test/deliverable.test.ts`), the `CacheEntry` field and its two writes in `packages/board/src/server/fleet.ts`, the call sites in `packages/board/src/server/deliver.ts` and `packages/board/src/server/board.ts`, the board unit tests, and one changeset.

Verified at dispatch, 2026-10-02: two open branches touch `fleet.ts`, in other regions. `bug/a-delta-keeps-the-store-whole` edits `CacheEntry` (around line 856, one new field) and `freshCacheEntry` (line 3609), so the three-line merge in `freshCacheEntry` can conflict: keep both fields. `bug/the-row-reads-the-hand-over` edits `buildFleet` (line 7869 onward) and adds a block near 6243. Neither touches `deliver.ts`, `board.ts` or `deliverable.ts`. #1139's change to `deliver.ts:237` is already on main; call `allSlicesConfirmed`, not `allSlicesMerged`.

Out of scope, report only: `planEstate`, `activeSprints` and `estateTotals` in `buildFleet` (`fleet.ts:7764-7768`) also read `entry.pulse` with `entry.pulseComplete`. They feed sprint and estate counts, not a delivery decision, and the plan does not name them. If they show the same flicker, say so in the PR and leave them. Auto-delivery's retry path (`inFlight`) belongs to #1139's plan.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

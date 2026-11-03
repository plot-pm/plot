## Implementation brief — registry-never-hands-out-an-approved

- **Plan (canonical):** docs/plans/2026-11-03-registry-never-hands-out-an-approved.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3095 merged
- **Branch:** `bug/the-queue-hands-out-an-approved-spike` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention (`plot/review` on the PR head)

This is the only slice of the plan. Nothing waits on it and it waits on nothing.

### What to build

Measured 2026-11-03: an approved spike of a Design plan reads `eligible` in `plot-fleet-scan.sh` (`claimable=1 eligible=1`), `plot-dispatch.sh` hands it to the registry, and every `plot-fleetd` tick then prints `handed=0 held=25 not-claimable=25`. No agent starts the spike. Cause: `sliceVerdicts` (`packages/domain/src/rules/eligible.ts:157`) admits a spike only with `phase=design`, one branch in the slice, `spike` true and `spikeApproved` true. `assemblePlanWalk` passes both fields. `planQueue` (`queue.ts:928-937`) and `blockingBranches` (`known-pr.ts:192-205`) pass neither, because both are optional on `SliceReadings`.

Build one pure function, `sliceReadingsOf(plan: PlanRecord, outstanding: readonly number[]): SliceReadings[]`, in the new `packages/domain/src/rules/slice-readings.ts` (arrow function, factual TSDoc). Call it from `planQueue`, `blockingBranches` and `assemblePlanWalk`, each keeping its own `outstanding` count. Make `SliceReadings.spike` and `.spikeApproved` required keys typed `boolean | undefined` so `tsc` refuses a fourth caller that omits them. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **`spikeApproved` stays `plan.spikeApprovedRaw !== undefined && plan.spikeApprovedRaw !== ''`**, the predicate `plan-walk-assembly.ts:334` uses today. Not `.trim() !== ''` (`gate.ts:575`, `approve.ts:723`). Reason: the scan's answer must not change, the parser already trims (`plot-plan-meta.sh:460-464`), and eleven test fixtures in five files cast partial objects to `PlanRecord` without `spikeApprovedRaw` — `.trim()` throws a `TypeError` on each one that reaches a caller.
- **`spike` is `spikeOf(plan.slices)?.slice === s`** (`spike.ts:37-41`). The builder holds the whole plan, so it takes no function parameter. Two markers admit no slice. `assemblePlanWalk` drops its `spikeCounts`/`spikeSliceOf` lines and its own `spikeApproved` line, but keeps the marker sum for `tracer: planSpikes > 0` (`:391`).
- **`branches` is `slice.branches.length`, deferred included**, as both callers count today.
- **`blockingBranches` takes the `PlanRecord` in place of `phase` and the slice lines**; `landedWithoutListing` (`queue-reading.ts:620-622`) passes `plan`.
- **No new hold word.** The queue keeps `not-claimable`; `QueuedBranch` carries no verdict, so the agreement test compares claimability, not words.
- **Out of scope:** restart (`plot-restart-command.mjs`), the approval record naming no branch (#3101), the pulse `tracer` flag (#3102), the restart refusal wording (#3100). Do not touch them.
- Carried rule: absent is not false. `undefined` means "the caller did not read it"; `sliceVerdict` reads both with `=== true`.

Sites that must state both keys once they are required: `packages/board/src/server/entry/verdicts.ts:112-113` (`slicesFrom` writes `spike: undefined` and `spikeApproved: undefined` where a line stops short — answers do not change); `packages/domain/test/eligible.test.ts` (the `owed` helper and inline literals), `empty-slice.test.ts`, `transitions-slice.test.ts`.

### Done when

The plan's `## Design › Tests` list is the specification. The assertions that exist because a naive implementation passes without them:

- **Queue admits the approved spike** — fails on `main` with 0 claimable; set `spikeApprovedRaw` and the `spike` flag explicitly, the `plan()` helper at `queue.test.ts:104-112` sets neither.
- **Closed-admission cases** (pass on `main`, hold the fix honest): two markers; marker without record; Draft with record; spike slice naming a second branch, also with it deferred; merged spike (slice reads `complete`, slice 2 `unapproved`).
- **`blockingBranches` answers `[spike branch]`** for an approved unsettled spike, `[]` without the record.
- **Builder unit test** covering every branch for the 100 % gate (`packages/domain/vitest.config.ts:71`): zero/one/two markers, marker in slice 0 and 1, `spikeApprovedRaw` `undefined`/`''`/record, deferred counted.
- **Queue agrees with the walk**: per branch, `claimable` equals membership in `assemblePlanWalk`'s `claimable` list; fixtures all-open or all-merged; matrix of phases draft/design/approved/delivered with and without record, plus design with spike in slice 0, in slice 1 behind open slice 0, and two markers. Fails on `main` in exactly one cell.

All tests go in `packages/domain/test/`, not `corpus/`.

Plus: add `.changeset/the-queue-hands-out-an-approved-spike.md` exactly as the plan's `### Changeset` section gives it (package `plot`, description first, `plan:`/`bumps:` block last). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the `CI suites` run in CI and a failure there comes back as a correction. List no full suite. Do not commit a rebuilt `board-server.mjs`. `scripts/check-shell-lines.sh` refuses shell growth under `skills/`; this slice should touch no `.sh` file.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`); `--draft` while the work moves. Append `→ #<number>` to the branch line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/{slice-readings,eligible,queue,known-pr}.ts`, `packages/domain/src/workflows/plan-walk-assembly.ts`, `packages/fleet/src/shared/queue-reading.ts` (the one call), `packages/board/src/server/entry/verdicts.ts`, the listed domain tests, and the changeset. No other branch of this plan is in flight. If you find something the plan did not anticipate, report it rather than improvising outside scope.

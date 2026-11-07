# Registry never hands out an approved spike of a Design plan

> The fleet scan reports an approved spike as eligible, and the registry queue holds the same branch as `not-claimable`. Both call `sliceVerdicts`, and only the scan passes it `spike` and `spikeApproved`.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3092
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3095 merged
- **Started:** 2026-11-03, Jan Wloka, `bug/the-queue-hands-out-an-approved-spike`
- **Delivered:** 2026-11-06
- **Released:** 2026-11-07, v2.31.0

## Changelog

- The supervisor hands an approved spike of a Design plan to a free agent. The registry queue and the fleet scan give the same verdict for the branch.

<!-- Board impact: one board source file changes. `packages/board/src/server/entry/verdicts.ts` (`slicesFrom`) states `spike` and `spikeApproved` as explicit `undefined` where a line stops short of them, because both keys become required on `SliceReadings`. Its answers do not change. main rebuilds the board artifact after merge. No change to the plan format, template or docs/plans layout. -->

## Motivation

Measured 2026-11-03 on Plot 2.30.0, Bitbucket, with `plot-fleetd.mjs` at `820a708`. A Design plan carried `Spike approved: 2026-11-03` and one `<!-- spike -->` branch.

- `plot-fleet-scan.sh <slug>` reported the spike's slice as `eligible` (`claimable=1 eligible=1`).
- `plot-dispatch.sh --max 1 <slug>` printed `handed over feature/<spike> → the registry`.
- Every later `plot-fleetd` tick printed `handed=0 held=25 not-claimable=25 no-free-agent=0`, and all three agent manifests kept `"branch": ""`.

`sliceVerdicts` (`packages/domain/src/rules/eligible.ts:157`) admits a spike only where `phase` is `design`, the slice names one branch, `spike` is true and `spikeApproved` is true (`eligible.ts:132-134`). Both fields are optional on `SliceReadings` (`eligible.ts:41`, `:48`), so a caller that omits them compiles. Three domain callers build readings from a plan, and they differ:

- `assemblePlanWalk` (`packages/domain/src/workflows/plan-walk-assembly.ts:320-340`) passes both. It sets `spikeApproved` at `:334` and `spike` through `spikeSliceOf` over the whole plan at `:337-340`. The fleet scan runs this walk.
- `planQueue` (`packages/domain/src/rules/queue.ts:928-937`) passes `outstanding`, `phase` and `branches` only. For a Design plan the rule answers `unapproved`, so every queue item gets `claimable: false` (`queue.ts:944`), and `whyNotReady` holds it as `not-claimable` (`queue.ts:600`).
- `blockingBranches` (`packages/domain/src/rules/known-pr.ts:192-205`) passes the same three fields. Its one caller is the queue's landing walk, `landedWithoutListing` (`packages/fleet/src/shared/queue-reading.ts:622`). For an approved spike it answers `[]`, so the queue never asks by PR number whether the spike landed.

The effect: `/plot-approve --spike` records the approval and `/plot-dispatch` hands the branch over, but no agent starts work. That is the one path Plot offers for starting a Design plan's tracer.

## Design

### Approach

One pure function in the domain turns a plan record into slice readings. `planQueue`, `blockingBranches` and `assemblePlanWalk` all call it, and the type makes a fourth caller state the spike fields.

**The builder.** A new file `packages/domain/src/rules/slice-readings.ts` exports `sliceReadingsOf = (plan: PlanRecord, outstanding: readonly number[]): SliceReadings[]`, an arrow function with factual TSDoc. For each slice of `plan.slices` it returns:

- `outstanding`: `outstanding[s]`, as the caller counts it.
- `phase`: `plan.phase`.
- `branches`: `slice.branches.length`, deferred branches included, as both callers count today.
- `spike`: `spikeOf(plan.slices)?.slice === s` (`packages/domain/src/rules/spike.ts:37-41`). The builder holds the whole plan, so it calls `spikeOf` and never takes a function as a parameter. `spikeOf` answers `undefined` for zero markers and for two or more, so a plan with two markers admits no slice. For a whole plan this is the same answer `spikeSliceOf(counts, planSpikes)` gives at `plan-walk-assembly.ts:339`.
- `spikeApproved`: `plan.spikeApprovedRaw !== undefined && plan.spikeApprovedRaw !== ''`.

**The `spikeApproved` test, and why.** The builder keeps the predicate `assemblePlanWalk` uses today (`plan-walk-assembly.ts:334`) and not `.trim() !== ''` from `gate.ts:575` and `approve.ts:723`.

- The scan's answer does not change, so the fix moves only the queue.
- The parser already trims the value (`val_after_colon`, `skills/plot/scripts/plot-plan-meta.sh:460-464`), and `plan-store-shell.ts:168` maps an absent value to `''`. A whitespace-only record never reaches a `PlanRecord` from the shell store, so `.trim()` adds no production case.
- Eleven test fixtures in five files cast a partial object to `PlanRecord` without `spikeApprovedRaw` (`queue.test.ts`, `plan-walk-report.test.ts`, `queue-reading.test.ts`, `the-queue-reads-the-merge-subject.test.ts`, `index-monitor.test.ts`). Under `.trim()` each fixture that reaches one of the three callers would throw a `TypeError`. The `!== undefined` arm reads such a fixture as "no record", which is the answer those tests expect.
- The builder's own unit test covers the `undefined` arm with a cast fixture, so the 100 % branch gate holds.

**The callers.** Each caller keeps its own `outstanding` rule. Only the field set is shared.

- `planQueue` calls `sliceReadingsOf(plan, …)` with its `settled` count (`queue.ts:930`).
- `assemblePlanWalk` calls it with its landing count (`plan-walk-assembly.ts:321-329`, including the `--loose` readiness arm). It drops its own `spikeCounts`/`spikeSliceOf` lines (`:337-340`) and the `spikeApproved` line (`:334`). `tracer: planSpikes > 0` (`:391`) still needs the marker count, so the walk keeps that one sum.
- `blockingBranches` takes the `PlanRecord` in place of `phase` and the slice lines, and calls the builder with its own `open` count. `landedWithoutListing` (`queue-reading.ts:620-622`) passes `plan`.

**The type is the gate.** `SliceReadings.spike` and `SliceReadings.spikeApproved` become required keys typed `boolean | undefined` (`eligible.ts:41`, `:48`). `undefined` keeps its meaning "the caller did not read it", and `sliceVerdict` reads both with `=== true`, so no verdict changes. `tsc` then refuses any site that builds readings without stating both keys. The sites that must change in this slice:

- `packages/board/src/server/entry/verdicts.ts:112-113`: `slicesFrom` spreads `{}` where a line stops short of the spike columns. It writes `spike: undefined` and `spikeApproved: undefined` there instead.
- `packages/domain/test/eligible.test.ts` (the `owed` helper at `:16` and the inline literals), `packages/domain/test/empty-slice.test.ts` and `packages/domain/test/transitions-slice.test.ts`: every inline `SliceReadings` literal states both keys. The domain `tsconfig.json` includes `test`, so `tsc` checks them.

`packages/fleet` and the board's other `sliceVerdict` (`packages/board/src/server/fleet.ts`, a different function over a verdict word) build no `SliceReadings`.

**The hold word.** The queue keeps `not-claimable` for a branch no slice admits, including the spike of an unapproved Design plan. It adds no `unapproved` word. `QueuedBranch` carries `claimable` and no verdict, so the agreement test below compares claimability and not words.

The change follows `CLAUDE.md`: arrow functions and factual TSDoc in the domain, the rule stays in the domain, and the fleet controller passes a value.

### Tests

All tests go in `packages/domain/test/`, not `corpus/`: the comparison is between two TypeScript callers, and the corpus tier holds a rule against a shell twin. Each test name says what fails on `main`, or that it holds the admission closed.

**The queue admits the approved spike (fails on `main`: 0 claimable).** A Design plan with `Spike approved:` and one `<!-- spike -->` branch as the only branch of slice 0, plus a second slice: `planQueue` returns exactly one item with `claimable: true`, the spike branch by name, and `claimable: false` for every other branch. The fixture sets `spikeApprovedRaw` and the `spike` flag explicitly; the `plan()` helper at `queue.test.ts:104-112` sets neither.

**The queue admits nothing (passes on `main`, holds the admission closed after the fix).** Each case asserts zero claimable items from `planQueue`:

- a Design plan with `Spike approved:` and two marked branches in two single-branch slices;
- a Design plan with one marked branch and no `Spike approved:` record;
- a Draft plan with one marked branch and a `Spike approved:` record;
- a Design plan with `Spike approved:` whose spike slice also names a second branch, and the same with the second branch deferred;
- a Design plan whose approved spike has merged: the spike's slice reads `complete`, and slice 2 reads `unapproved`, so its branches are not claimable.

**`blockingBranches` asks about the approved spike (fails on `main`: answers `[]`).** The same Design plan with an approved, unsettled spike: `blockingBranches(plan, settled)` answers `[spike branch]`. Without the record it answers `[]`.

**The builder.** A direct unit test of `sliceReadingsOf` covers every branch for the 100 % gate (`packages/domain/vitest.config.ts:71`): zero, one and two markers; the marker in slice 0 and in slice 1; `spikeApprovedRaw` `undefined` (a cast fixture), `''` and a record; `outstanding` and `branches` passed through, deferred branches counted.

**The queue agrees with the walk (fails on `main` in one cell).** For each branch `planQueue` returns, `claimable` equals membership in `assemblePlanWalk`'s `claimable` list, which holds only branches of `eligible` slices (`plan-walk-assembly.ts:351`). The fixtures hold branches that are all open or all merged, because the two `outstanding` rules differ on purpose for `wip` and claimed branches. The matrix: phases `draft`, `design`, `approved` and `delivered`, each with and without a `Spike approved:` record, and for `design` the spike in slice 0, the spike in slice 1 behind an open slice 0, and two markers. On `main` it fails only for `design` with a record and the spike in slice 0.

### Out of scope

- **Restart.** `plot-restart-command.mjs` stays as it is. Restart is for a claimed slice whose worker died. A never-started spike has no worktree, so a fixed lookup would change `unknown-branch` only to `no-worktree` (`packages/fleet/src/shared/restart-command.ts:120-122`). After this fix the registry hands the spike out, and no restart is needed. The pulse already carries Design plans: `assemblePlanWalk` drops only `released`, `rejected`, `superseded` and delivered docs/infra plans (`plan-walk-assembly.ts:19`, `:302-303`), and `branchFromPulse` (`packages/fleet/src/shared/continue-command.ts:28-45`) has no phase filter. The misleading refusal for a missing, stale or foreign-version pulse is #3100.
- **The approval record names no branch.** #3101. After this fix fleetd acts on a moved marker without a person.
- **The pulse's `tracer` flag.** #3102. The schema says `Tracer: yes`; the walk computes it from spike markers.

### Changeset

`.changeset/the-queue-hands-out-an-approved-spike.md`, in the slice's branch. `@plot-pm/domain` is private (`packages/domain/package.json:6`) and ships inside the `plot` bundles, so the changeset names `plot`, as fleetd's own changesets do:

```markdown
---
'plot': patch
---

fleetd's registry queue now hands an approved spike of a Design plan to a free agent: the queue, the queue's landing walk and the fleet scan build their slice readings through one domain function, so all three read `<!-- spike -->` and `Spike approved:` the same way.

<!--
plan: docs/plans/2026-11-03-registry-never-hands-out-an-approved.md
bumps:
  skills:
    plot: patch
-->
```

## Slices

### Shared slice readings

- `bug/the-queue-hands-out-an-approved-spike` — add `sliceReadingsOf`, make the spike fields required keys, call the builder from `planQueue`, `blockingBranches` and `assemblePlanWalk`, add the tests and the changeset <!-- builds: a shared slice-readings builder used by planQueue, blockingBranches and assemblePlanWalk --> → #3105

## Notes

- Source: https://github.com/plot-pm/plot/issues/3092. The issue's workaround starts the loop by hand in a worktree on the spike branch.
- Round 1: four-juror panel, `.plot/panels/2026-11-03-registry-never-hands-out-an-approved/panel.md`. Filed from it: #3100 (restart refusal), #3101 (record names no branch), #3102 (`tracer` meaning).
- Related plans: `2026-10-01-the-queue-reads-the-order-the-scan-reads.md` (same scan/queue disagreement, other fields), `2026-10-27-no-controller-restarts-a-stopped-slice.md`.

# Registry never hands out an approved spike of a Design plan

> The fleet scan reports an approved spike as eligible, and the registry queue holds the same branch as `not-claimable`. Both call `sliceVerdicts`, and only the scan passes it `spike` and `spikeApproved`.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3092
- **Review:** pr
- **Impl:** own branches

## Changelog

- The supervisor hands an approved spike of a Design plan to a free agent. The registry queue and the fleet scan give the same verdict for the branch.
- `plot-restart-command.mjs` restarts the worker of an approved spike of a Design plan instead of answering `unknown-branch`.

<!-- Board impact: none expected. The board's own verdicts (`packages/board/src/server/entry/verdicts.ts`) already pass the spike fields; this plan changes the fleet queue and the restart lookup. Confirm in the first slice. -->

## Motivation

Measured 2026-11-03 on Plot 2.30.0, Bitbucket, with `plot-fleetd.mjs` at `820a708`. A Design plan carried `Spike approved: 2026-11-03` and one `<!-- spike -->` branch.

- `plot-fleet-scan.sh <slug>` reported the spike's wave as `eligible` (`claimable=1 eligible=1`).
- `plot-dispatch.sh --max 1 <slug>` printed `handed over feature/<spike> → the registry`.
- Every later `plot-fleetd` tick printed `handed=0 held=25 not-claimable=25 no-free-agent=0`, and all three agent manifests kept `"branch": ""`.

`sliceVerdicts` (`packages/domain/src/rules/eligible.ts:157`) admits a spike only where `phase` is `design`, `branches` is 1, `spike` is true and `spikeApproved` is true (`eligible.ts:132`). The callers differ:

- `assemblePlanWalk` (`packages/domain/src/workflows/plan-walk-assembly.ts:330-340`) passes `spikeApproved` and `spike`, found with `spikeSliceOf`.
- `planQueue` (`packages/domain/src/rules/queue.ts:928-936`) passes `outstanding`, `phase` and `branches` only. For a Design plan the rule answers `unapproved`, so the queue item gets `claimable: false`.

The restart controller shows a second symptom. `restartBranch` (`packages/fleet/src/shared/restart-command.ts:117-118`) answers `unknown-branch: no plan on this board names that branch` for the spike of a Design plan, so a person cannot hand the spike to a worker with `--restart` either. The cause is not read yet: the pulse that `branchFromPulse` searches may omit Design plans.

The effect: `/plot-approve --spike` records the approval and `/plot-dispatch` hands the branch over, but no agent starts work. That is the one path Plot offers for starting a Design plan's tracer.

## Design

### Approach

One function turns a plan record into slice readings, and `planQueue` and `assemblePlanWalk` both call it. A reading field added later then reaches both callers.

- Extract the readings builder from `assemblePlanWalk` into the domain (`packages/domain/src/rules/`), taking `PlanRecord`, `spikeSliceOf` and the `outstanding` count per slice.
- `planQueue` calls it with its own `settled` count. `assemblePlanWalk` calls it with its own landing count. The two callers keep their own `outstanding` rule; only the field set is shared.
- A test in `packages/domain/test/` builds a Design plan with `Spike approved:` and one `<!-- spike -->` branch and asserts exactly one claimable queue item, and none for the plan's other branches.
- A corpus-style test asserts that `planQueue` and `assemblePlanWalk` give the same verdict for the same plan across phases `draft`, `design`, `approved`, with and without an approval record.
- Read `branchFromPulse` and the pulse writer for a phase filter that drops Design plans, and fix it where one exists.

The change follows `CLAUDE.md`: arrow functions in the domain, and the rule stays in the domain with the controllers calling it.

### Open Questions

- [ ] Does the restart lookup fail because the pulse omits Design plans, or because the plan list `restartBranch` reads filters on phase? The first slice answers this before it fixes it.
- [ ] Does any other `sliceVerdicts` caller omit the spike fields? `known-pr.ts:200` builds readings by hand and needs the same check.
- [ ] Which hold word does the queue report for a spike of an unapproved Design plan after the fix? The scan reports `unapproved`; the queue must agree.

## Slices

### Queue verdicts

- `bug/the-queue-hands-out-an-approved-spike` — build the shared slice readings, use them in `planQueue`, and cover them with the Design-plan spike test <!-- builds: a shared slice-readings builder used by planQueue and assemblePlanWalk --> <!-- spike -->

### Restart lookup

- `bug/restart-finds-the-spike-of-a-design-plan` — make `plot-restart-command.mjs` find the spike of a Design plan, and check `known-pr.ts` for the same gap

## Notes

- Source: https://github.com/plot-pm/plot/issues/3092. The issue's workaround starts the loop by hand in a worktree on the spike branch.
- Related plans: `2026-10-01-the-queue-reads-the-order-the-scan-reads.md` (same scan/queue disagreement, other fields), `2026-10-27-no-controller-restarts-a-stopped-slice.md`.

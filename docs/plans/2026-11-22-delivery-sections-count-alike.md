# The sprint header and the Fleet section count alike

> The sprint header counts every slice in one of five states that add up to its total and names the fleet hold of a slice that waits, and every Fleet row names the branch, plan and sprint it acts on.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-ui-polish
- **Review:** pr
- **Impl:** own branches

## Changelog

- The sprint header shows every slice in one of five counts: delivered, at a gate, being built, blocked and not started. The five counts add up to the slice total.
- A not-started slice that the fleet holds is counted as held, and the count names the hold, for example "1 held: no brief".
- Every Fleet row names the plan and the slice it acts on, and marks a sprint member with the sprint's name.
- A blocked Fleet row names its branch. It no longer shows "…".

<!-- Board impact: the Delivery tab only (packages/board, packages/domain). No plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

On 2026-11-22 the operator read the Delivery tab and saw two sections that seemed to contradict each other. The sprint header read "7 plans · 11 of 16 slices delivered · 1 at a gate · 0 blocked". The Fleet section read "5 working". Only 1 of the 5 working agents acted on a sprint slice; the other 4 acted on bug and infra plans outside the sprint. Neither section said so.

Three facts were missing:

1. **The header counts three of five states.** `SLICE_STATES` (`packages/domain/src/rules/slice-states.ts:9`) defines `delivered`, `blocked`, `at-a-gate`, `being-built` and `not-started`, and `countSliceStates` counts all five. `headerCountParts` (`packages/domain/src/rules/release-plan-rows.ts:299`) prints only `delivered`, `at-a-gate` and `blocked`. So 4 of the 16 slices had no count, and the header gave no answer to "is anything being built".
2. **A held slice reads as not started.** `feature/delivery-work-items-grid` was held by fleetd on `no-brief`, and `feature/delivery-activity-signals` waited on it. Both read `not-started`, the same as a slice nobody had reached yet. The hold was visible only in `.plot/logs/fleetd.log` ("held on no-brief (4)").
3. **The Fleet rows do not say what they act on.** In the same reading, one of 5 working rows showed an "acts on" line with its plan and slice. The `/api/fleet` agent rows carry `branch` and no plan field. Both blocked rows showed "…" with no item.

## Design

### Approach

Every count and every row label is a domain property, as the layering rule requires. The board renders what the domain returns.

- **Header counts.** `headerCountParts` returns all five states in `SLICE_STATES` order, and their sum is `total`. A state with a count of 0 still shows, so the line keeps its shape. `unread` stays outside the total and shows only above 0, as now.
- **Held slices.** A new rule takes the fleet's hold reading for a `not-started` slice and returns the hold, or none. The header prints held slices as a part of `not started` with the hold's words, for example "4 not started (1 held: no brief, 1 waits on delivery-work-items-grid)". The rule reads only what fleetd records; it does not re-derive a hold.
- **Fleet rows.** A new rule maps an agent's branch to its plan, slice and sprint with the existing `planForBranch` (`packages/domain/src/rules/plan-for-branch.ts`). Every Fleet row shows the result in the "acts on" line. A branch that no plan names shows "no plan".
- **Blocked rows.** A blocked row names its branch, from the same reading as a working row.

### Open Points

- [ ] `[question-hold-source]` Where does the board read fleetd's holds? Today fleetd writes them only to its log, and `/api/fleet` carries `heldNote: null`. The recommendation is that fleetd writes each tick's holds to a state file under `.plot/state/` and the board reads it, the same way `last-pulse.json` reaches `plot-dispatch-command.mjs`.
- [ ] `[question-unknown-state]` In the same reading, all 5 working agents had `state: "unknown"` and the board said it "could not read the state of 18 worktrees", while each row said "writing code". Is that a second defect for this plan, or its own bug plan? The recommendation is its own bug plan, since it is a reading failure and not a count.
- [ ] `[decision-zero-counts]` A count of 0 still shows. The alternative hides it, but then the parts no longer add up visibly to the total.

## Slices

- `feature/sprint-header-counts-every-state` — the header prints all five slice states and they add up to the total <!-- builds: headerCountParts over all five SLICE_STATES -->
- `feature/a-held-slice-names-its-hold` — fleetd records its holds per tick, and the header names the hold of a not-started slice <!-- builds: a fleet hold state file and a sliceHold rule -->
- `feature/fleet-rows-name-their-plan` — every Fleet row, working or blocked, names its branch, plan, slice and sprint <!-- builds: an agentActsOn rule over planForBranch -->

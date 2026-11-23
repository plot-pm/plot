# The sprint header and the Fleet section count alike

> The Release delivery section header counts every slice in five states that add up to its total and counts the held ones, the slice line names each hold, and every Fleet row names the branch, plan and sprint it acts on.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** delivery-ui-polish
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-22, Jan Wloka, plan-PR #3656 merged
- **Started:** 2026-11-22, Jan Wloka, `feature/delivery-header-counts-every-state`
- **Started:** 2026-11-23, Jan Wloka, `feature/a-held-slice-names-its-hold`
- **Started:** 2026-11-23, Jan Wloka, `feature/fleet-rows-name-their-plan`
- **Delivered:** 2026-11-23
- **Released:** 2026-11-23, v2.36.0

## Changelog

- The Release delivery section header (Sprint delivery under My sprint) shows every slice in one of five counts: delivered, blocked, at a gate, being built and not started. The five counts add up to the slice total, and a count of 0 shows grey and links nowhere.
- The not-started count says how many of its slices are held, for example "4 not started · 2 held". The slice line names each hold: "not started · no brief" or "not started · waits on Work items grid".
- Every Fleet row names the branch, plan and slice it acts on, also for an agent on a desk whose branch the registry did not record. A row of an agent on a sprint member carries the sprint's name; a row with no sprint mark is work the sprint header does not count.
- A blocked Fleet row names its branch in its Branch cell.

<!-- Board impact: the Delivery tab only (packages/board, packages/domain). No plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

On 2026-11-22 the operator read the Delivery tab and saw two sections that seemed to contradict each other. The Sprint delivery section header read "7 plans · 11 of 16 slices delivered · 1 at a gate · 0 blocked". The Fleet section read "5 working". Only 1 of the 5 working agents acted on a sprint slice; the other 4 acted on bug and infra plans outside the sprint. Neither section said so.

Three facts were missing:

1. **The section header names three of five states.** `SLICE_STATES` (`packages/domain/src/rules/slice-states.ts:9`) defines `delivered`, `blocked`, `at-a-gate`, `being-built` and `not-started`. The header's bar holds all five (`releaseDeliveryHeader().bar`, `release-plan-rows.ts:366`), and the tab header's Release group legend shows them (`ReleaseGroup.tsx:57-79`). The section header's text figures come from `headerCountParts` (`release-plan-rows.ts:299`), which names only `delivered`, `at-a-gate` and `blocked`, so 4 of the 16 slices had no figure. `HeaderStrip` (`release-plan-rows.ts:290`) admits only two states, and the sprint and release blocks in `delivery-view.ts` (`:989`, `:996`, `:1002`) pass only `{ blocked }`.
2. **A held slice reads as not started, with no reason.** `feature/delivery-work-items-grid` waited for a brief, and `feature/delivery-activity-signals` waited on it. Both counted `not-started`, the same as a slice nobody had reached yet. The `/api/fleet` rows carry both facts (`brief: missing`, `blockedBy`), and the Delivery tab shows neither. fleetd's own dispatch skip reasons (`PlanSkipReason`, `auto-dispatch.ts:816`) reach only its log.
3. **The Fleet rows do not say what they act on.** In the same reading, 28 of 29 `/api/fleet` agent entries were synthesized desks with `branch: ""` and the branch in `checkout`; `branch` stays empty for such a desk by design (#1101, `schema.ts:4075-4088`). The board's placement reads only `agent.branch` (`delivery-readings.ts:397`), so a desk agent acts on nothing, and `delivery-view.ts:855-857` drops its "acts on" line. A blocked Fleet row comes from a stopped role run, and `RoleRunSchema` (`schema.ts:4509-4523`) carries no `branch`, so the row has no branch to name.

## Design

### Approach

Every count and every row label is a domain property, as the layering rule requires. The board renders what the domain returns, and no slice reads a new file.

- **Header counts.** `headerCountParts` takes the five-state counts (`SliceStateCounts`) in place of `HeaderStrip`. It returns them in `SLICE_STATES` order (delivered, blocked, at a gate, being built, not started), the same order as the header's bar; the test at `release-plan-rows.test.ts:215` changes with it. `releaseDeliveryHeader` and the three callers in `delivery-view.ts` pass all five, summed from `PlanRowView.strip` per state as `releaseDeliveryHeader` already does; no second sum is added. A count of 0 shows grey and links nowhere (`target: null`). `unread` stays outside the total and shows only above 0. An agent on a slice whose PR waits on a gate counts under at a gate, not being built (`sliceStateOf`, `slice-states.ts:68-71`).
- **Held slices.** A new rule, `notStartedHold`, returns the hold of a `not-started` slice from readings the board already holds: `no brief` where the slice's row reads `brief: missing` or `startability: needs-brief`, and `waits on <slice>` where its `WorkItemReading.waitsOn` names one; otherwise none. The header's not-started part gains a held count with no reasons ("4 not started · 2 held"), because the design spec keeps header text visual and not a sentence. The slice line in Release delivery and the Work items row name the hold through the pills that `feature/release-delivery-plan-rows-unfold` builds (`slicePills`, `workItemPills`). The hold is a sub-count of `not-started` and never sets `heldBy`; `sliceStateOf` stays unchanged. The existing `sliceHold` (`verdict.ts:106`) keeps its meaning.
- **Fleet rows.** A new rule, `agentActsOnBranch`, reads an agent's `branch`, then its `checkout`, for display only. The item link, plan, slice and sprint come from the payload row with that branch, which already carries `plan` and `sprint`. The sprint mark reuses `rowSprintMembership` (`sprint-selection.ts:160`) and draws as a grey pill, as plan 5 draws "no sprint". Placement and `blockedOn` keep reading `branch` alone, as #1101 requires. A working row whose process state reads `unknown` still shows its acts-on item. The rule fills the working-on tuple that `feature/fleet-switches-in-fleet-section` draws.
- **Blocked rows.** `RoleRunSchema` gains `branch`, the writer of the role-run state records it, and `agentRowFactsOf` (`delivery-row-facts.ts:144-149`) reads it. The Branch cell of a blocked row names the branch.

### Open Points

- [x] `[question-hold-source]` The board derives `no brief` from the row's `brief`/`startability` and `waits on` from `WorkItemReading.waitsOn`, both on `/api/fleet` today. No new state file: a per-tick hold file would be a second persisted verdict, which *Answers, never verdicts* in CLAUDE.md refuses. fleetd-only holds (`ref-held`, `in-flight`, `refused`, `no-free-agent`) stay out of the count.
- [x] `[question-unknown-state]` The `state: "unknown"` reading of 19 worktrees is a reading failure, not a count, and gets its own bug plan. Until it lands, a working row with `state: unknown` still shows its acts-on item.
- [x] `[decision-zero-counts]` A count of 0 shows grey and links nowhere, so the five parts sum to the total visibly. The Release group legend keeps hiding zeros, because its bar shows the proportions.
- [x] `[decision-fleet-sprint-count]` The Fleet group shows no sprint count. The spec says Fleet and Machine take no scope; the per-row sprint mark tells which working agents the sprint header counts.

## Slices

### Header counts

- `feature/delivery-header-counts-every-state` — the Release delivery section header and the sprint and release block headers print all five slice states, and they add up to the total <!-- builds: headerCountParts over SliceStateCounts --> <!-- tests: release-plan-rows.test.ts — the five parts sum to total, a 0 count has target null; delivery-view.test.ts and sprint-delivery-view.test.ts header strings --> → #3662
### Held slices

- `feature/a-held-slice-names-its-hold` <!-- waits: feature/release-delivery-plan-rows-unfold --> — the not-started count names how many slices are held, and the slice line names each hold <!-- builds: notStartedHold --> <!-- tests: slice-states.test.ts — a held queued slice still counts not-started; a needs-brief row gives no brief, a waitsOn gives waits on, neither gives none --> → #3675
### Fleet rows

- `feature/fleet-rows-name-their-plan` <!-- waits: feature/fleet-switches-in-fleet-section --> — every Fleet row, working or blocked, names its branch, plan, slice and sprint <!-- builds: agentActsOnBranch, branch then checkout for display; RoleRunSchema.branch --> <!-- tests: a board unit test — a synthesized agent with branch '' and checkout X links to X's item, plan and sprint and keeps its placement group; delivery-readings.test.ts — a stopped run with no matching row gives facts.branch --> → #3676

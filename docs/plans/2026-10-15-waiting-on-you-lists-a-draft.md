# Waiting on you lists a Draft plan's slices beside its plan row, not under it

> A Draft plan's PLAN row sorts after its SLICE rows in Waiting on you, because the plan row counts as an ungrouped row and closes the plan-head gate.

## Status

- **State:** Released
- **Type:** bug
- **Issue:** #1740
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-15, Jan Wloka, plan-PR #1741 merged
- **Started:** 2026-10-15, Jan Wloka, `bug/waiting-on-you-lists-a-draft`
- **Delivered:** 2026-10-15
- **Released:** 2026-10-16, v2.27.1

## Changelog

- Waiting on you shows a Draft plan's slices nested under the plan row instead of beside it.

<!-- Board impact: changes board row grouping (packages/board/src/app/lib/agent-rows/sections.ts and AgentList.tsx). No change to the plan format, template, helper scripts or docs/plans layout. -->

## Motivation

Seen 2026-10-15 on the board, Waiting on you: plan `a-lifecycle-micro-pr-merged-past` (Draft, PR #1738) shows three SLICE rows (Retry, Pin, Identities), each "waiting on approval — plan not approved yet — still in review", followed by a separate PLAN row for the same plan. The slices belong under the plan row.

Cause, from issue #1740:

- `fleet.ts:4949` gives the plan's `idea/` PR branch a row of kind `plan` with no `wave`.
- `draftPlacement` (`fleet.ts:3476` and three other places) puts every slice of a Draft plan into `waiting-on-you` as `wave` rows.
- The plan row and its slices land in one plan group.
- `planHeads` (`AgentList.tsx:1649-1651`) heads a group with its plan row only when `ungroupedRows(...)` is empty. The plan-kind row has no `wave`, so `ungroupedRows` returns it and the gate stays closed. The group falls back to flat rows, and the plan row sorts after the slices.
- The text-heading fallback is off for this section by design (`AgentList.tsx:1622-1623`).

Not a regression: the gate dates from f85a8ca1b (#680, 2026-09-03) and 028e4311a. Draft plans with named slices only recently started to appear in this section. No test covers a mixed group (a plan-kind row plus `wave` rows) in `waiting-on-you`.

## Design

### Approach

Decide the group's shape in pure code, with a unit test: `{ head, slices, loose }`. A `plan`-kind row carrying the group's plan slug becomes `head` and does not count as `loose`.

`planHeads` then reads "a head exists, or every row is slice-grouped", and keeps the existing `sliceRowsShown` and `PlanRow` rendering.

Two places hold this decision today and both change together:

- `AgentList.tsx:1649-1651` computes `planHeads` from `ungroupedRows(...).length === 0`.
- `sectionTally` in `sections.ts:471` repeats the same predicate (`loose.length === 0 && grouped.length > 0`) so the section's counts match the render. Left alone, the tally would count the plan and its slices as separate lines after the render nests them.

The shape function belongs in `sections.ts` beside `ungroupedRows`, so both callers read one answer. This follows *Every rendered state is a domain property* in `CLAUDE.md`: the grouping is asserted in a unit test, and one browser test shows the nested render.

### Open Questions

- [ ] Does the plan row, once it heads the group, still show its own "waiting on approval" wording, or does it state the slices' shared verdict? `sliceRowsShown` and the sole-slice verdict path in `AgentList.tsx` already decide this for other sections; reuse their answer.
- [ ] Which rows are `plan`-kind in other grouping sections (Not started, Done)? Confirm the new head rule does not change those sections.

## Slices

### Group shape

- `bug/waiting-on-you-lists-a-draft` — Add the `{ head, slices, loose }` group shape in `sections.ts` with unit tests for a mixed group (plan-kind row plus `wave` rows), make `planHeads` in `AgentList.tsx` and `sectionTally` read it, and add one browser test showing a Draft plan's slices nested under its plan row in Waiting on you. → #1746 <!-- builds: groupShape, the head/slices/loose split of a plan group -->

## Notes

- Issue: https://github.com/plot-pm/plot/issues/1740. The plan's `Issue:` field is the only link to the tracker.

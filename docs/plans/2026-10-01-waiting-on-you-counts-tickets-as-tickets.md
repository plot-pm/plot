# WAITING ON YOU counts tickets as tickets

> The WAITING ON YOU header adds every ticket to both its plan figure and its slice figure, and leaves stopped agents out of both. Three plans, six slices and fifteen tickets read `(18 plans · 21 slices)`.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1146
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The WAITING ON YOU header names each kind of line it counts: plans, slices, tickets and stopped agents, for example `(3 plans · 6 slices · 15 tickets)`. A ticket no longer reads as a plan or a slice.

Board impact: one `@plot-pm/board` patch. No payload, schema or plan-format change.

## Motivation

Measured 2026-10-01 on `localhost:7777`: with 3 plans (6 slices) and 15 tickets on screen, the header read `(18 plans · 21 slices)`; with 18 tickets it read `(21 plans · 24 slices)`.

Read on `7206c9d8`:

- `sectionTally` (`packages/board/src/app/lib/agent-rows/sections.ts:422`) returns `plans = planLines + issueCount` and `slices = sliceLines + issueCount`.
- `AgentList.tsx:1159` passes `issues.length + drafts.length` as `issueCount`. A draft plan with no branch is one plan line and no slice, so it inflates the slice figure the same way.
- Stopped agents (`brokenRows`, `AgentList.tsx:467`) render in WAITING ON YOU after the tickets but reach `sectionTally` not at all. `countOf` (`:1033-1037`) counts them, so a section holding only one stopped agent passes the `countOf + issues.length > 0` test at `:1186` and prints the label, which `sectionTally` computes as `(0)` above one visible row. Read from the code, not reproduced. This is the same defect in the other direction.
- `AgentList.tsx:1163-1165` renders either `(N)` or `(N plans · M slices)`, so there is no place in the label for any other kind.

**Why the tickets were folded in.** `f733ac9d` (#414, 2026-08-25) made the header equal to the lines a reader sees, after `NOT STARTED (2)` sat above four lines. The doc comment at `sections.ts:410-412` says tickets "count toward BOTH figures" for that reason, and `agent-list.test.ts:3887` (*folds issue rows into the visible count*) pins it. That rule stays: every visible line is counted. What changes is that each line is counted under its own name, so the sum still equals the lines a reader sees, and no figure claims a kind it does not hold.

## Design

### Approach

**`sectionTally` counts each kind under its own name.** Its fourth argument becomes `{ tickets, drafts, agents }` instead of one number. It returns `{ plans, slices, tickets, agents }`:

- `plans` = plan lines from the rows + `drafts` (a draft plan is a plan line).
- `slices` = slice lines from the rows only.
- `tickets` and `agents` = their counts, unchanged.

**One pure function decides the label.** `tallyLabel(tally)` in `sections.ts` returns the header text, so the wording is unit-tested and the component only renders it:

- Only plan lines, and `plans === slices`: `(N)`, as today, so `QUIET (0)` stays `(0)`.
- Otherwise each non-zero figure with its unit, in the order plans, slices, tickets, stopped agents, singular at 1: `(3 plans · 6 slices · 15 tickets)`, `(15 tickets)`, `(1 plan · 2 slices · 1 stopped agent)`.
- The visible top-level line count equals `plans + tickets + agents` when every head is collapsed. The doc comment states this invariant, replacing the "count toward BOTH figures" paragraph.

`AgentList.tsx:1157-1165` passes `{ tickets: issues.length, drafts: drafts.length, agents: broken.length }` and renders `tallyLabel(tallyOf)`. WORKING keeps its single agent count.

### What this does NOT do

- **It does not change any other section's count.** Only WAITING ON YOU receives tickets, drafts or stopped agents; for the other sections the extra figures are zero and the label is unchanged.
- **It does not change the `not sprint-filtered` suffix** at `AgentList.tsx:1178-1183`.

## Slices

### The tally names its tickets (Branch: bug/the-tally-names-its-tickets)

`sectionTally` with the new argument and result, `tallyLabel`, and the call site. Unit tests: 3 plans and 6 slices with 15 tickets give `(3 plans · 6 slices · 15 tickets)`; tickets alone give `(15 tickets)`; one stopped agent alone gives `(1 stopped agent)`; a draft plan with no branch adds to plans and not slices; QUIET at 0/0 stays `(0)`; an ungrouped section with equal plans and slices and no extras stays `(N)`. The existing test *folds issue rows into the visible count* is rewritten to assert the named figures, since it pins the behaviour this plan replaces. The browser test in `a-plan-less-row-is-not-a-plan.browser.test.ts` that asserts `(3 plans · 4 slices)` is checked and updated only if its fixture carries tickets. A `'@plot-pm/board': patch` changeset. <!-- builds: tallyLabel, the WAITING ON YOU header wording -->

## Done when

- `tallyLabel` and `sectionTally` are unit-tested for the six cases above, and the header on a board with 3 plans, 6 slices and 15 tickets reads `(3 plans · 6 slices · 15 tickets)`.
- A section holding only a stopped agent prints `(1 stopped agent)`.
- `pnpm run test:board` and `pnpm run typecheck` pass.

## Notes

Found by the operator on 2026-10-01, reading the new sprint's WAITING ON YOU section.

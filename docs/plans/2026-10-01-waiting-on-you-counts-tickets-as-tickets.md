# WAITING ON YOU counts tickets as tickets

> The WAITING ON YOU header adds every ticket to both its plan figure and its slice figure, and leaves stopped agents out of both. Three plans, six slices and fifteen tickets read `(18 plans · 21 slices)`.

## Status

- **State:** Delivered
- **Approved:** 2026-10-01, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1146
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2
- **Started:** 2026-10-01, Jan Wloka, `bug/the-tally-names-its-tickets`
- **Delivered:** 2026-10-02

## Changelog

- A section header names each kind of line it counts: plans, slices, branches with no plan, tickets and stopped agents, for example `(3 plans · 6 slices · 15 tickets)`. A ticket no longer reads as a plan or a slice, and a branch no plan names no longer reads as a plan.

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

**`sectionTally` counts each kind under its own name.** Its fourth argument becomes `{ tickets, drafts, agents }` instead of one number. It returns `{ plans, slices, branches, tickets, agents }`:

- `plans` = top-level lines of groups that carry a plan, as `planLines` computes them today, plus `drafts` (a draft plan is a plan line).
- `slices` = lines a reader reaches by expanding those groups' heads, as `sliceLines` computes them today, for groups that carry a plan only.
- `branches` = rows of the plan-less group (`plan === ''`). Each renders as one line, because `showPlanHeading` and `planHeads` never head that group.
- `tickets` and `agents` = their counts.

**A branch no plan names is not counted as a plan.** `a-plan-less-row-is-not-a-nameless-plan` (#973, Released 2.21.0) removed the nameless `PLAN` head and its thesis is *"a group with no plan has nothing to head, and no count to hide in"*. It still counted each plan-less row under `plans`: `a-plan-less-row-is-not-a-plan.browser.test.ts:108` asserts `(3 plans · 4 slices)` for one plan head over two slices plus two plan-less rows, and `agent-list.test.ts:411` asserts `.plans` is 2 for the plan-less bucket alone. This plan finishes that thesis in every section, because `sectionTally` serves all five branch sections: the same NOT STARTED fixture reads `(1 plan · 2 slices · 2 branches)`, and WAITING ON YOU with one plan-less PR row and two tickets reads `(1 branch · 2 tickets)`, not `(1 plan · 1 slice · 2 tickets)`.

**One pure function decides the label.** `tallyLabel(tally)` in `sections.ts` returns the header text, so the wording is unit-tested and the component only renders it:

- Only plan lines, and `plans === slices`: `(N)`, as today. `QUIET (0)` stays `(0)`.
- Otherwise each non-zero figure with its unit, in render order plans, slices, branches, tickets, stopped agents, singular at 1.
- **The slice figure prints only where it differs from the plan figure**, whatever else the header holds: two ungrouped plan lines and one ticket read `(2 plans · 1 ticket)`, never `(2 plans · 2 slices · 1 ticket)`.
- A section with plan lines only at 0 and one other kind prints that kind with its unit: `(15 tickets)`, `(1 stopped agent)`, `(2 branches)`.

**The invariant.** With every head collapsed, the visible top-level lines equal `plans + branches + tickets + agents`. The doc comment states it, replacing the paragraph that says issues "count toward BOTH figures" (`sections.ts:410-412`). A browser test asserts it against the rendered section, because a unit test has only `sectionTally`'s own line count to compare with, and that compares the function with itself.

**The `not sprint-filtered` suffix stops repeating the count.** Today `AgentList.tsx:1178-1183` prints ` · N not sprint-filtered (issues, draft plans, stopped agents)`, where N is `issues + drafts + broken`, the same lines the new header already names. A second pure function, `unfilteredNote({ tickets, drafts, agents }, filterActive)`, returns ` · tickets, draft plans and stopped agents are not sprint-filtered`, naming only the kinds that are present, and an empty string when the filter is off or none is present. The `data-sprint-unfiltered` attribute keeps its number, so a test can still read the count without the reader reading it twice.

**Narrow width.** The tally is a `<span>` inside the heading button, whose classes are `flex items-center gap-2` with no `whitespace-nowrap` or `truncate` (`AgentList.tsx:1277`). A longer header wraps inside its own flex item beside the label; nothing truncates and the page does not scroll sideways. Read from the classes, not measured; the slice adds no width test, because the decision this plan makes is the wording, which the unit tests carry.

`AgentList.tsx:1157-1165` passes `{ tickets: issues.length, drafts: drafts.length, agents: broken.length }` and renders `tallyLabel(tallyOf)`. WORKING keeps its single agent count.

**DONE and QUIET change too.** `sectionTally` serves every branch section, so a DONE or QUIET header gains a `branches` figure wherever plan-less rows sit, for example a merged PR that no plan names. Measured on this estate at `34200acb` (2026-10-01, 16:59 UTC): the fleet payload holds rows only in WAITING ON YOU, 8 rows and none plan-less, so DONE and QUIET hold no rows and their headers read `(0)` before and after the change.

### What this does NOT do

- **It does not change how a plan's own rows fold.** A plan whose rows render without a head (`planHeads` false because a row is loose) still counts each of its lines under `plans`, as `planLines` does today. That is a plan's lines named as plan lines, not another kind named as a plan.
- **It adds no browser test.** The invariant is a new assertion inside the existing test at `unplanned-issues.browser.test.ts:328`, so `EXPECTED_TESTS` in `stubbed-tests-start-no-board.test.ts` is unchanged.

## Slices

### The tally names its tickets (Branch: bug/the-tally-names-its-tickets, PR: #1156)

`sectionTally` with the new argument and result, `tallyLabel`, `unfilteredNote`, and the call site. A `'@plot-pm/board': patch` changeset. <!-- builds: tallyLabel, unfilteredNote, the section header wording -->

Unit tests in `agent-list.test.ts`, each asserting the label string:

- 3 plans, 6 slices, 15 tickets: `(3 plans · 6 slices · 15 tickets)`.
- 15 tickets alone: `(15 tickets)`.
- One stopped agent alone: `(1 stopped agent)`.
- One plan-less branch row and two tickets: `(1 branch · 2 tickets)`.
- One plan head over two slices plus two plan-less rows in NOT STARTED: `(1 plan · 2 slices · 2 branches)`.
- Two ungrouped plan lines and one ticket: `(2 plans · 1 ticket)`.
- A draft plan with no branch adds to plans and not slices.
- QUIET at 0/0: `(0)`; an ungrouped section with equal plans and slices and nothing else: `(N)`.
- `unfilteredNote`: off when the filter is off, names only present kinds, carries no number.

Tests rewritten, because they pin the behaviour this plan replaces:

- The eight unit call sites that pass a number as the fourth argument: `agent-list.test.ts:411, 3855, 3864, 3881, 3898, 3920, 3927, 3929`. Line 411 asserts `.branches` is 2 and `.plans` is 0 for the plan-less bucket; line 3898 (*folds issue rows into the visible count*) asserts the named figures.
- `test/integration/unplanned-issues.browser.test.ts:328` (*counts issue rows in the section tally*) asserts `(1 branch · 2 tickets)` instead of `(3)`, and asserts the invariant: it counts the section's rendered top-level rows (one branch row, two ticket rows) and asserts that the count equals the sum of the header's figures, 1 + 2 = 3.

Tests that survive unchanged:

- `test/integration/sprint-exempt.browser.test.ts:214-218` (*says which of the section tally the sprint filter never saw*). It reads `data-sprint-unfiltered`, which keeps its number, and asserts that the note contains `not sprint-filtered`, which the new note still does.
- `test/integration/a-plan-less-row-is-not-a-plan.browser.test.ts:108` asserts `(1 plan · 2 slices · 2 branches)` instead of `(3 plans · 4 slices)`.

## Done when

- `tallyLabel`, `sectionTally` and `unfilteredNote` are unit-tested for the cases above, and the header on a board with 3 plans, 6 slices and 15 tickets reads `(3 plans · 6 slices · 15 tickets)`.
- No section header counts a ticket, a stopped agent or a plan-less branch as a plan or a slice.
- A section holding only a stopped agent prints `(1 stopped agent)`.
- With the filter on, the `not sprint-filtered` note carries no number.
- The rewritten `unplanned-issues.browser.test.ts:328` asserts that the section's rendered top-level rows equal the sum of the header's figures.
- `pnpm run test:board` and `pnpm run typecheck` pass, and `EXPECTED_TESTS` is unchanged.

## Notes

Found by the operator on 2026-10-01, reading the new sprint's WAITING ON YOU section.

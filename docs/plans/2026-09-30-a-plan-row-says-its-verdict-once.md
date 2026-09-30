# A plan row says its verdict once

> A one-slice plan prints its slice's verdict on the plan row and again on the slice row beneath it: `Testing complete` above `complete`.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #1103
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- A one-slice plan shows its slice's verdict once: on the slice row where that row prints it, and on the plan row where the slice row shows a PR state or is folded away.

Board impact: yes. The plan row's status cell changes for every one-slice plan; the payload is unchanged.

## Motivation

Measured 2026-09-30: `a-cold-bitbucket-board-buys-the-whole-list` (PR #1061) renders `Testing` `complete` on its plan row and `complete` on its slice row.

`PlanRow` (`packages/board/src/app/lib/agent-rows/rows.tsx`) prints `soleSlice.verdict` in the status cell, where a multi-slice plan prints its PR fold. The rule rested on a premise its docstring states: *"A plan with one slice renders NO slice row: the plan row carries the slice's verdict, and a second row would state the same thing twice."* `AgentList.tsx:1645` now renders a slice row for every plan (*"SLICE ROWS NAME THEIR SLICES, however many slices the plan has"*), so the verdict is stated twice, which is the outcome the rule was written to prevent.

## Design

### The rule

**A one-slice plan's verdict appears exactly once among the rows a reader can see.** The plan row prints it only where the slice row does not.

### Where the slice row already prints it

The slice row's status word is not the verdict everywhere (measured by the round-1 juror at origin/main `63a39bec`):

| Where | Slice row shows | Plan row after this plan |
|---|---|---|
| NOT STARTED, plan head open | the verdict (a one-slice plan is not foldable there) | no verdict; the PR fold, as a multi-slice plan |
| WAITING ON YOU, QUIET, DONE, plan head open, slice row's `soleRowStatus` empty (merged, deferred, no PR) | the verdict | no verdict; the PR fold |
| WAITING ON YOU, QUIET, DONE, plan head open, `soleRowStatus` a PR word (`green`, `checks failing`, …) | the PR word | the verdict, as today |
| any section, plan head collapsed (the `shut:` override) | nothing: the slice row is hidden | the verdict, as today |

The measured case, `a-cold-bitbucket-board-buys-the-whole-list` in DONE with a merged PR, is the second row: the slice row prints `complete`, so the plan row prints `Testing` and its fold, and `complete` shows once.

In the third row the plan row keeps the verdict and prints no fold, so the PR word shows once, on the slice row, and the verdict once, on the plan row.

### One function decides

The choice is a view state, so it is computed once and tested without a browser, per *Every rendered state is a domain property*: a function `planRowShowsSoleVerdict({ sliceRowVisible, sliceRowStatus })` beside `soleRowStatus` in `packages/board/src/app/lib/agent-rows/stuck.ts` answers `true` when the slice row is hidden or prints a PR word, and `false` when it prints the verdict. `PlanRow` (`rows.tsx`) asks it before printing `soleSlice.verdict` in `statusExtra`; `AgentList.tsx` passes whether the head is open.

**`soleSlice` keeps its other job.** It still carries the one-slice plan's *Start work* action onto the plan row (`rows.tsx:877-881`, `soleSlice?.verdict === 'eligible' && card && dispatch`); that gate is untouched.

**The comments that state the old rule are rewritten** to state this one: the `soleSlice` docstring, `rows.tsx:539`, `:746-750`, `:753`, `AgentList.tsx:1580`, `:1645`, `:1908`, `:2019`, and the header of `plan-rounds-badge.browser.test.ts`.

## Done when

- `planRowShowsSoleVerdict` has a unit test per row of the table above.
- A browser test over a one-slice plan with a merged PR in DONE, head open, renders `complete` once, on the slice row, and no `data-sole-wave-verdict` on the plan row.
- A browser test over a one-slice plan in WAITING ON YOU with an open PR, head open, renders the verdict on the plan row and the PR word on the slice row.
- A collapsed one-slice plan head renders its verdict on the plan row.
- A one-slice plan in NOT STARTED renders its verdict on the slice row only, and an `eligible` one still carries *Start work* on the plan row.
- Every comment listed above states the new rule.

## Slices

### A plan row says its verdict once (Branch: bug/a-plan-row-says-its-verdict-once)

`planRowShowsSoleVerdict` and its unit test, `PlanRow`'s status cell, the comments naming the old rule, and new browser tests; no existing test asserts the plan-row verdict.

## Notes

Filed while reading the board on 2026-09-30; the slice row returned for one-slice plans before this, and the plan-row verdict was left behind.

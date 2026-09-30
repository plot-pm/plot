# A plan row says its verdict once

> A one-slice plan prints its slice's verdict on the plan row and again on the slice row beneath it: `Testing complete` above `complete`.

## Status

- **State:** Approved
- **Approved:** 2026-09-30, jwloka, in-session
- **Started:** 2026-09-30, jwloka, `bug/a-plan-row-says-its-verdict-once`
- **Type:** bug
- **Issue:** #1103
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 4

## Changelog

- A one-slice plan shows its slice's verdict once: on the slice row where that row prints it, and on the plan row where the slice row shows a PR state or is folded away.

Board impact: yes. The plan row's status cell changes for every one-slice plan; the payload is unchanged.

## Motivation

Measured 2026-09-30: `a-cold-bitbucket-board-buys-the-whole-list` (PR #1061) renders `Testing` `complete` on its plan row and `complete` on its slice row.

`PlanRow` (`packages/board/src/app/lib/agent-rows/rows.tsx`) prints `soleSlice.verdict` in the status cell, where a multi-slice plan prints its PR fold. The rule rested on a premise its docstring states: *"A plan with one slice renders NO slice row: the plan row carries the slice's verdict, and a second row would state the same thing twice."* `AgentList.tsx:1645` now renders a slice row for every plan (*"SLICE ROWS NAME THEIR SLICES, however many slices the plan has"*), so the verdict is stated twice, which is the outcome the rule was written to prevent.

## Design

### The rule

**Within one section, a one-slice plan's verdict appears exactly once among the rows a reader can see.** The plan row prints it only where the slice row beneath it in that section does not. The rule is per section: `soleSliceFor` ignores the section, so a plan whose rows split across NOT STARTED and WAITING ON YOU renders a plan row in each, and each carries its own answer.

### What the slice row prints

The slice row's status comes from one of two sources (measured by the round-2 juror with `soleRowStatus` bundled from `stuck.ts` at origin/main `04f18780`):

- **A one-branch slice** (`soleRow` set) prints `soleRowStatus(soleRow)`. That is an empty string only when the PR state is `unknown`; every other row prints a word of its own: a PR state (`green`, `checks failing`), `deferred`, `delivered`, `open`, `working` or `stalled`. Where it is empty, the slice row prints the verdict.
- **A slice holding several branches** (`soleRow` undefined) prints the verdict with a count: `N <verdict>` or `<verdict> · N left`.

So the slice row prints the verdict when it is visible and either has no `soleRow` or its `soleRowStatus` is empty.

| Slice row | Plan row |
|---|---|
| hidden: head collapsed (the `shut:` override), or not rendered by the section's visibility expression, which includes `hasExceptions` | the verdict, as today |
| visible, several branches | no verdict; the PR fold |
| visible, one branch, `soleRowStatus` empty | no verdict; the PR fold |
| visible, one branch, `soleRowStatus` a word | the verdict, and no fold |
| NOT STARTED, every branch deferred: the section renders no slice row | the verdict |

The measured case, `a-cold-bitbucket-board-buys-the-whole-list` in DONE, prints `complete` on its slice row with an empty `soleRowStatus`, so its plan row drops `complete`. WORKING and WAITING ON A MACHINE render no plan row, and Draft plans render under NOT STARTED.

### One function decides

The choice is a view state, so it is computed once and tested without a browser, per *Every rendered state is a domain property*: `planRowShowsSoleVerdict({ sliceRowVisible, soleRowStatus })` beside `soleRowStatus` in `packages/board/src/app/lib/agent-rows/stuck.ts`, where `soleRowStatus` is the string for a one-branch slice and `null` for a slice of several branches. It answers `true` when `sliceRowVisible` is false, or when `soleRowStatus` is a non-empty string; `false` otherwise. `AgentList.tsx` computes both inputs at its two `PlanRow` call sites, from expressions each site already has:

| Call site | `sliceRowVisible` | `soleRowStatus` |
|---|---|---|
| NOT STARTED (`:1582`) | the not-started slice groups are non-empty: `groupBySlice(group.rows.filter(isUnbegun)).length > 0`; an all-deferred plan renders none | `null`: the `SliceRow` here gets no `soleRow` and always prints the verdict |
| WAITING ON YOU, QUIET, DONE (`:1911`, the `planHeads` sections) | the head is open, or `hasExceptions` keeps its rows shown | `soleRowStatus(row)` for a slice of one branch, `null` for several |

`rows.tsx:877` is the gate for the plan row's *Start work* action and not a call site; it is unchanged. `PlanRow` asks the function before printing `soleSlice.verdict` in `statusExtra`, and prints no fold where it prints the verdict.

**`soleSlice` keeps its other job.** It still carries the one-slice plan's *Start work* action onto the plan row (`rows.tsx:877-881`, `soleSlice?.verdict === 'eligible' && card && dispatch`); that gate is untouched.

**The comments that state the old rule are rewritten** to state this one: the `soleSlice` docstring, `rows.tsx:539`, `:746-750`, `:753`, `AgentList.tsx:1580`, `:1645`, `:1908`, `:2019`, and the header of `plan-rounds-badge.browser.test.ts`.

## Done when

- `planRowShowsSoleVerdict` has a unit test per row of the table above, including `soleRowStatus: null` for a slice of several branches.
- A browser test over a one-slice plan in DONE whose one branch has `pr.state: 'unknown'`, head open, renders the verdict text once, on the slice row, and no `data-sole-wave-verdict` on the plan row.
- A browser test over a one-slice plan in WAITING ON YOU with an open PR, head open, renders the verdict on the plan row and the PR word on the slice row, with no fold on the plan row.
- A browser test over a one-slice plan whose slice holds two branches renders the verdict on the slice row only.
- A collapsed one-slice plan head in WAITING ON YOU renders its verdict on the plan row; a one-slice plan in NOT STARTED has no fold, so the case exists only in the `planHeads` sections.
- A one-slice Approved plan whose branches are all deferred renders its verdict on its plan row in NOT STARTED.
- A one-slice plan in NOT STARTED with an unbegun branch renders its verdict once, on the slice row, and an `eligible` one still carries *Start work* on the plan row.
- Every comment listed above states the new rule.

## Slices

### A plan row says its verdict once (Branch: bug/a-plan-row-says-its-verdict-once)

`planRowShowsSoleVerdict` and its unit test, `PlanRow`'s status cell, the comments naming the old rule, and new browser tests; no existing test asserts the plan-row verdict.

## Notes

**Implementation notes from round 4.** At `:1911` the slice's one row is `wg.rows[0]`. At `:1582` `expanded` is always `null` for a one-slice plan, so the fold guard needs no input, and `groupBySlice(group.rows.filter(isUnbegun))` is pure in `group.rows` and can move up to the `PlanRow` call.

Filed while reading the board on 2026-09-30; the slice row returned for one-slice plans before this, and the plan-row verdict was left behind.

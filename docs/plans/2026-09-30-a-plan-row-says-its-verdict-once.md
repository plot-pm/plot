# A plan row says its verdict once

> A one-slice plan prints its slice's verdict on the plan row and again on the slice row beneath it: `Testing complete` above `complete`.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #1103
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A one-slice plan's row no longer repeats its slice's verdict; the verdict shows once, on the slice row, and the plan row shows its branches' PR state as a multi-slice plan's row does.

Board impact: yes. The plan row's status cell changes for every one-slice plan; the payload is unchanged.

## Motivation

Measured 2026-09-30: `a-cold-bitbucket-board-buys-the-whole-list` (PR #1061) renders `Testing` `complete` on its plan row and `complete` on its slice row.

`PlanRow` (`packages/board/src/app/lib/agent-rows/rows.tsx`) prints `soleSlice.verdict` in the status cell, where a multi-slice plan prints its PR fold. The rule rested on a premise its docstring states: *"A plan with one slice renders NO slice row: the plan row carries the slice's verdict, and a second row would state the same thing twice."* `AgentList.tsx:1645` now renders a slice row for every plan (*"SLICE ROWS NAME THEIR SLICES, however many slices the plan has"*), so the verdict is stated twice, which is the outcome the rule was written to prevent.

## Design

**The status cell of a plan row does not depend on its slice count.** `PlanRow` drops the `soleSlice?.verdict` branch of `statusExtra`, so a one-slice plan falls to the `prFold` branch every plan with more slices already takes. The rounds badge before it is unchanged.

**`soleSlice` keeps its other job.** It still carries the one-slice plan's *Start work* action onto the plan row (`soleSlice?.verdict === 'eligible' && card && dispatch`); that gate reads the verdict and prints nothing. The prop's docstring is rewritten to say what it does now: carry the sole slice's actions, not its status.

**The verdict is a slice fact.** The slice row renders it for every plan, so removing it from the plan row loses nothing a reader could see before.

## Done when

- A one-slice plan row renders no `data-sole-wave-verdict` element, and its status cell holds what a two-slice plan row holds for the same PR states; a browser test asserts both over a one-slice and a two-slice fixture.
- The slice row of that one-slice plan still renders its verdict.
- A one-slice plan whose slice is `eligible` still carries *Start work* on the plan row.
- The `soleSlice` docstring states the action role and no longer says a one-slice plan has no slice row.

## Slices

### A plan row says its verdict once (Branch: bug/a-plan-row-says-its-verdict-once)

`PlanRow`'s status cell, the `soleSlice` docstring, and the browser tests that assert the sole-slice verdict on the plan row.

## Notes

Filed while reading the board on 2026-09-30; the slice row returned for one-slice plans before this, and the plan-row verdict was left behind.

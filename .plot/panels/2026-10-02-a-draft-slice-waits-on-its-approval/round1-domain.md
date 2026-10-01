# Round 1: domain design and testability

Position: amend

## 1. Does it fix the issue

It fixes `blocked`, `waiting` and `unknown`, the 15 measured rows. It misses the issue's third Done-when, "the board payload never carries `verdict: unapproved` with `group: not-started`". The table returns `null` for `claimed` and `wip`, and on origin/main both arms still return `not-started` for a Draft plan with no worker: `return { group: 'not-started', note: unstarted };` (fleet.ts:5054, claimed within the quiet window) and `return { group: 'not-started', note: last commit … ago }`  (fleet.ts:5146, wip within the quiet window). The catch-all at :5137 also skips the phase.

## 2. Code claims on origin/main (5da3e923)

- `function classifyGroup(` is at fleet.ts:4096. This is true, but the function is not exported. The tests must call `classify` (:5446).
- `return { group: 'waiting-on-you', note: DRAFT_PLAN_NOTE };` is at :4471 and :4744. This is true.
- `const prerequisite = waitsOn || 'an unnamed prerequisite';` is at :5123, not :5122. `blocked` is at :5124.
- `if (readings.phase !== DISPATCHABLE_PHASE) return 'unapproved';` is at eligible.ts:107, `if (planPhase === 'draft') return 'waiting-on-approval';` is at verdict.ts:60, and `DRAFT_PLAN_NOTE` is at schema.ts:1588. All three are true.

## 3. Tests

- The `draftPlacement` cases fail today. The rule is a pure arrow over values, and 100% branch coverage is reachable.
- The board cases for `blocked`, `waiting` and `unknown` fail today. The Approved and `running` cases pass today, and the plan labels them as pins.
- The invariant test "every BranchState with `planPhase: 'draft'` ... no result has `group: 'not-started'`" is self-contradictory. With `ageMinutes <= quietMinutes`, `claimed` and `wip` return `not-started` after the fix, so the test fails. With `ageMinutes: null` or a large value, both escape and the test passes vacuously. The plan names no age or worker fixture.

## 4. Unspecified or broken

- The three call sites share one rule, so the design holds. The unknown-phase checks (:4490, :4746) stay outside the rule, and the no-work arms get none: a `withdrawn` plan's `blocked` slice still reads NOT STARTED.
- The order with #1150 is wrong for one case. A Draft `open` slice that a free agent was handed now reads WAITING ON YOU, so `withHandOver` skips it, and the row contradicts WORKING, which is #1150's defect. A Draft `claimed` slice stays `not-started`, so `withHandOver` moves it to WORKING. The sentence "a Draft plan's slice is no longer `not-started`" is false for `claimed` and `wip`.

## Required changes

1. Decide `claimed` and `wip` (no worker, within the quiet window) for a Draft plan. Either route both through `draftPlacement` at :5054/:5146 and the :5137 catch-all, or narrow the issue's invariant and say so in the Changelog.
2. Make the invariant test name its fixtures: `ageMinutes` both `null` and `0`, worker `none` and `elsewhere`, PR absent. Assert over the cross product, so that it cannot pass vacuously.
3. Name `classify` (exported) as the test entry point, not `classifyGroup`.
4. State the #1150 outcome for a Draft slice that an agent holds, for both `open` and `claimed`, and add one test for it to whichever slice merges second.
5. Correct `:5122` to `:5123`.

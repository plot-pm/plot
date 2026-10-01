# Round 1: skeptic

Position: amend

**Executed.** I read the plan and #1161 on `origin/main` (`508abec3`). I ran a scratch vitest file in a detached worktree. It calls the exported `classify` (the wrapper over `classifyGroup`) for `draft` and `approved` × all 8 `BranchState` values × age `null`/5/5000, plus `blocked`/`waiting`/`unknown` with a `running` worker. `shelved` is not a `BranchState` (`entities/fleet.ts:54-63`), so the issue's `shelved` is `deferred`.

## Measured today (draft, worker none)

| state | group | note |
|---|---|---|
| blocked | not-started | `waits for bug/prereq, which has no pull request` (all ages) |
| waiting | not-started | `waits for bug/prereq` |
| unknown | not-started | `state unknown — …` |
| open, deferred | waiting-on-you | DRAFT_PLAN_NOTE |
| **claimed, age 5** | **not-started** | `claimed, no known worker` |
| **wip, age 5** | **not-started** | `last commit 5 min ago` |
| claimed/wip, null or 5000 | waiting-on-you | — |
| merged | done | — |

`blocked`/`waiting`/`unknown` with a running worker give `working`. The defect reproduces exactly as the issue states.

## 1. Does the plan fix the issue?

It fixes the 15 measured rows: `blocked`, `waiting` and `unknown`. It does not meet the issue's third Done-when, *"never carries `verdict: unapproved` with `group: not-started`"*. A Draft plan's `claimed` or `wip` branch with a fresh age still reads `not-started`, and the plan's rule returns `null` for both.

## 2. Code claims (all hold on 508abec3)

- `:4096` `function classifyGroup(`.
- `:4120-4121` "to stop a DRAFT plan's branches reading `eligible`".
- `:4471` and `:4744` `return { group: 'waiting-on-you', note: DRAFT_PLAN_NOTE };`.
- `:5124` `return { group: 'not-started', note: \`waits for ${prerequisite}, which has no pull request\` };`.
- `schema.ts:1588` holds DRAFT_PLAN_NOTE.
- `eligible.ts:107` `if (readings.phase !== DISPATCHABLE_PHASE) return 'unapproved';`.
- `vitest.config.ts:71` is the 100 % glob.

## 3. Tests

- The domain tests and the blocked/waiting/unknown board cases fail today and pass after the fix. The approved-blocked and running-worker cases pass today, as the plan says.
- **The "every BranchState, no `not-started`" test contradicts the design.** If it sweeps ages, it fails *after* the fix on claimed/wip age 5. If it uses one age that avoids the fresh path, it proves less than its name says. `fleet.test.ts:970-980` also asserts that draft equals approved for `claimed`/`wip`, so the plan cannot move those two states without editing that test.

## 4. What the implementing agent would have to guess

- Is the invariant scoped to the five states? Or do `claimed`/`wip` move too, which means editing `fleet.test.ts:970-980`?
- `classifyGroup` is not exported, so the tests call `classify`. The plan names the wrong symbol.
- Does `draft-placement.ts` get exported from `packages/domain/src/index.ts`?
- `deriveSlices` (`fleet.ts:4032`) still sets `slice.section: 'not-started'` for every incomplete Draft slice. `slicesElsewhere`'s fallback compares that value with the row's section. The plan does not say whether plan heads now report "1 slice elsewhere".
- `draftPlanRows` (`working-agents.ts:109`) only drops a plan that already has a row, and `sliceSection` returns `null` for `unapproved`. So neither places a branch row, and the plan needs no change there.

## Required changes

1. Pick one: move `claimed`/`wip` into the rule (then rewrite `fleet.test.ts:970-980`), or limit the invariant and the Changelog to the five states. If you limit it, name the fresh claimed/wip case as known and out of scope.
2. Make the sweep test enumerate ages `null`, 5 and 5000, so it is discriminating.
3. Name `classify` as the tested entry point, and state the `index.ts` export.
4. State what `deriveSlices`' `section` does for a Draft slice, and add a plan-head assertion or an explicit non-goal.

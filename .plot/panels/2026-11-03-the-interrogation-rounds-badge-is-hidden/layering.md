# Layering juror — the-interrogation-rounds-badge-is-hidden

Position: amend

## Summary

The Planning-tab badge has exactly one decider, `cardControls`, and the plan changes it there. That part keeps every rendered state a domain property. The plan leaves a second decider unnamed: the Agents tab's WAITING ON YOU row decides "Draft only" in the board server (`draftPlanOf`) and restates the badge text in the board (`draftRoundsText`). The plan turns that into an open question for the implementer. An unattended agent must not settle a scope question, so the plan must settle it.

## Findings

1. **The card decision lives only in the domain. True.** `packages/domain/src/rules/card-controls.ts:79` sets `roundsBadge: draft`. The two production callers pass the plan state through: `packages/board/src/server/board.ts:2687` and `packages/board/src/server/mock-fleet.ts:477`. `PlanCard.tsx:223-227` (`roundsBadgeText`) gates on `card.controls.roundsBadge` and decides only the wording. `rows.tsx:638` reuses `roundsBadgeText(card)` for the Agents-tab plan row, so that row follows the domain too. The plan's claim "no `.tsx` logic changes" (plan line 42) holds.

2. **A second decider exists, outside the domain, and the plan does not name it.** `packages/board/src/server/board.ts:2998-3010` (`draftPlanOf`) admits a plan to `fleet.draftPlans` only where `meta.phase === 'draft'`. `working-agents.ts:130` documents "`draftPlans` holds Draft plans only — the server decides the phase". `draft-plan-row.tsx:27-55` then renders a rounds badge for every entry with no control flag, and `working-agents.ts:145-146` (`draftRoundsText`) restates `roundsBadgeText`'s wording. After the change a Design plan with no branch shows `not interrogated` on the Planning tab and gets no WAITING ON YOU row and no badge on the Agents tab. The two tabs then disagree about the same plan — the failure `rows.tsx:622-625` names as the reason for reusing one function.

3. **The open question (plan line 46) delegates a person's decision.** "Do other surfaces read the Draft-only scope as a fact? The implementer checks each before the change." The answer is yes for `draft-plan-row.tsx`/`working-agents.ts`/`draftPlanOf`, and no for `rows.tsx` (finding 1). Whether a Design plan with no branch is "waiting on you" is a product scope decision, not a mechanical check. Left open, a Sonnet agent either widens `draftPlanOf` (scope creep into the fleet payload, `DraftPlan` schema, `DRAFT_PLAN_NOTE` wording "plan not approved yet — still in review", and `draft-plan-row.browser.test.ts`) or skips it silently.

4. **A hand-written fixture restates the old rule.** `packages/board/test/integration/spike-card-states.browser.test.ts:18-27` builds a Design card's controls by hand with `roundsBadge: false`. It does not fail after the change, but it then contradicts `cardControls` for the same state. `test/fixtures/card-controls.ts:42-49` (`controlsFor`) exists so a fixture never restates the rule. The plan's test list omits this file.

5. **Stale wording outside the two TSDoc blocks the plan names.** `PlanCard.tsx:435-438` (JSX comment: "a Discovery-column answer"), `rounds-badge.test.ts:10-11` ("a Draft card carries the badge and a Design card does not") and `:54-56`, and `plan-rounds-badge.browser.test.ts:183` ("gates on `isDraft` — phase === 'Discovery'", already stale before this change). Board `CHANGELOG.md:1012` records the old scope; it is history and stays.

6. **Tests: which fail before and pass after.** `packages/domain/test/card-controls.test.ts:31-39` (`roundsBadge holds on draft only`) and `:56-60` (Design plan `roundsBadge: false`) fail after the change and must flip; they become the before/after proof. `rounds-badge.test.ts:54-63` loops over `'Design'` and asserts `''`; it fails after the change. `card-controls-fixture.test.ts` asserts nothing about Design and needs no change. The plan's instruction "keeps only the assertions that name Design" (plan line 40) reads as "delete the others"; the intended meaning is "change the assertions that name Design".

## Required amendments

A. Replace the open question with a decision and a named boundary: "Out of scope: the Agents tab's WAITING ON YOU row (`draftPlanOf`, `board.ts:2998`; `draftRoundsText`, `working-agents.ts:145`) stays Draft-only. A follow-up issue records that a Design plan with no branch has no WAITING ON YOU row." If the person wants the Agents tab in scope instead, the plan names `draftPlanOf`, `DRAFT_PLAN_NOTE`, the `DraftPlan` schema and `draft-plan-row.browser.test.ts`, and adds a second slice.

B. Name the before/after test: `card-controls.test.ts` `roundsBadge` holds on `draft` and `design` over every status and `started`, and the Design-plan `toEqual` case reads `roundsBadge: true`. Both fail on `origin/main` and pass after.

C. Add `spike-card-states.browser.test.ts:20` to the test list: set `roundsBadge: true` for its Design card, or build the controls through `controlsFor({ phase: 'Design' })`.

D. Reword plan line 40 to "change the assertions that name Design" and list the stale comments in finding 5 alongside the two TSDoc blocks.

## Decisions for a person

- Whether a Design plan with no branch belongs in WAITING ON YOU on the Agents tab (amendment A). The plan cannot leave it to the implementer.
- Optional, out of this plan: `draftPlanOf` decides a rendered population in `packages/board/src/server` rather than in the domain, and `draftRoundsText` duplicates `roundsBadgeText`. Both predate this plan; a follow-up issue can move them.

## Ran versus read

Ran (read-only): `git fetch origin main`, `git show origin/main:<file>` on `card-controls.ts`, `PlanCard.tsx`, `rows.tsx`, `draft-plan-row.tsx`, `working-agents.ts`, `board.ts`, `mock-fleet.ts`, `test/fixtures/card-controls.ts` and the five test files above; `git grep` for `roundsBadge`, `not interrogated`, `draftPlans`, `cardControls(`, `draftPlanOf`; `gh issue view 3088`. Did not run any test suite, build or board command. Findings 4 and 6 are read from the source, not executed.

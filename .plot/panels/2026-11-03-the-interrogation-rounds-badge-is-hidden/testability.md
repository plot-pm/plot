# Testability juror

Position: amend

## Summary

The fix is one line in a pure domain rule, and the existing tests already pin the old behaviour from both sides, so a red-before/green-after test exists today. The plan does not name it. It lists four candidate files and tells the implementer to "keep only the assertions that name Design", which reads as a deletion instruction and is wrong for two of the four files. The amendment names each test and its new expectation.

## Findings

1. The cause is true. `packages/domain/src/rules/card-controls.ts:62-63` defines `draft` and `underReview`; `:78` sets `interrogate: underReview`; `:79` sets `roundsBadge: draft`. The TSDoc at `:41-43` states the Draft-only scope. `PlanCard.tsx:212-214` states "Draft only" and "`draft` qualifies and `design` does not"; `:224` reads only `card.controls.roundsBadge`. The component makes no decision, so the domain unit test is the right subject (CLAUDE.md, "Every rendered state is a domain property").

2. Tests that fail after the change, and so must change (all on origin/main):
   - `packages/domain/test/card-controls.test.ts:31-39` — `roundsBadge holds on draft only: %s` expects `roundsBadge === (state === 'draft')`. The `design` case fails after the change.
   - `packages/domain/test/card-controls.test.ts:56-60` — `offers Approve and Interrogate on a Design plan, and not the rounds badge` expects `roundsBadge: false` in a `toEqual`. It fails after the change.
   - `packages/board/test/unit/rounds-badge.test.ts:54-64` — `appears only on Draft cards` loops over `['Design', 'Development', 'Testing', 'Released']` and expects `''`. `controlsFor({ phase: 'Design' })` maps to state `design` (`test/fixtures/card-controls.ts:23-29`) and calls the real `cardControls`, so the `Design` iteration fails after the change. The header comment at `:10-11` ("a Design card does not") also goes stale.

3. Tests the plan names that do not change behaviour:
   - `packages/board/test/unit/card-controls-fixture.test.ts` asserts `roundsBadge` only for `Discovery` (`:21`, true before and after). Its Design assertions are on `needsDesign` (`:10-11`), which this plan leaves alone. No edit is needed.
   - `packages/board/test/integration/plan-rounds-badge.browser.test.ts` uses only `Discovery` cards and one `Testing` card (`:81-88`). Every assertion holds before and after. The badge render path is the same for Draft and Design (`PlanCard.tsx:451`, `rows.tsx:638`), so no browser test is needed to prove Design renders. The comment at `:183` ("gates on `isDraft` — phase === 'Discovery'") is already stale and may be corrected, not required.

4. Tests the plan does not name:
   - `packages/board/test/integration/spike-card-states.browser.test.ts:18-27` hand-writes controls for a `phase: 'Design'` card with `roundsBadge: false`. It stays green, because the mock payload is fixed, but it no longer matches what the server computes for a Design plan. Either set `roundsBadge: true` there or derive it with `controlsFor({ phase: 'Design', ... })`.
   - A search for `data-plan-rounds`, `data-rounds`, `not interrogated` and `rounds` across `packages/board/test` found no other assertion on a Design card. `agents-tab.browser.test.ts`, `catalogue/states.ts` and `tuple-row.test.ts` carry `phase: 'Design'` fixtures and no rounds assertion. No screenshot or snapshot test exists under `packages/board/test`.

5. Coverage gate: `packages/domain/vitest.config` enforces 100% with `all: true`. The change replaces one identifier with another already-covered one, and `draft` stays in use at `:77` (`needsDesign`). Line and branch coverage do not move. No new test is needed for the gate; the rewritten tests in finding 2 cover the new value.

6. The second badge path is independent. `draft-plan-row.tsx` uses `draftRoundsText` (`working-agents.ts:145`) for Draft plans with no branch row, fed by the server's `draftPlans` list, and never reads `controls.roundsBadge`. This plan does not change it, so a Design plan with no branch still gets no Waiting-on-you row and no badge there. That is a scope question for the plan's open question, not a test gap, but the implementer needs to know that no test covers it either way.

## Amendments required

1. Replace "keeps only the assertions that name Design" with an explicit list:
   - `card-controls.test.ts:31` — rename to `roundsBadge holds on draft and design: %s` and expect `state === 'draft' || state === 'design'`, over the same `STATES` plus `'rejected'`, `'superseded'`, `'none'` (the `needsDesign` test already uses that wider list; the badge test should, so an unknown state proves `false`).
   - `card-controls.test.ts:56` — rename to `offers Approve, Interrogate and the rounds badge on a Design plan` and expect `roundsBadge: true`.
   - `rounds-badge.test.ts:54` — split: a Design card with `rounds: 3` reads `3 rounds` and with no rounds reads `not interrogated`; `Development`, `Testing`, `Released` still read `''`. Update the header comment at `:10-11`.
2. State that the first two rewritten domain tests fail on origin/main and pass after the one-line change. That is the red/green proof, and a reviewer verifies it by running `pnpm --filter @plot-pm/domain exec vitest run test/card-controls.test.ts` before and after.
3. State that `card-controls-fixture.test.ts` and `plan-rounds-badge.browser.test.ts` need no change, so an unattended agent does not edit them to "follow" the plan.
4. Add `spike-card-states.browser.test.ts:20` to the list (`roundsBadge: true`, or derive it from `controlsFor`).

## Decisions for a person

None for testability. Whether the Waiting-on-you Draft plan row (finding 6) should also include Design plans is a scope decision outside this lens.

## Ran versus read

Ran: `git fetch`, `gh issue view 3088`, `git show origin/main:<file>` and `git grep` over `packages/` for `roundsBadge`, `not interrogated`, `data-rounds`, `controlsFor`, `phase: 'Design'`, snapshot matchers. Read: the plan, the four named test files, `card-controls.ts`, `PlanCard.tsx`, `rows.tsx`, `working-agents.ts`, `test/fixtures/card-controls.ts`, `spike-card-states.browser.test.ts`, `interrogate-card.browser.test.ts`, the domain vitest coverage config. Ran no test suite, per the brief; the before/after claims rest on reading the assertions against the rule.

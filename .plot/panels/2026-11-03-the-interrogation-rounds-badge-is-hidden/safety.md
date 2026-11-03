# Safety juror — the-interrogation-rounds-badge-is-hidden

Position: amend

## Summary

No automation reads `roundsBadge` or the Draft-only scope, so the one-line change cannot move a phase, start an agent or open a gate. The risk is on the card itself: on Design, the new badge sits beside an *Interrogate* button that the server refuses, and its count has no staleness check. The plan does not name either fact.

## Findings

1. **The Design card's *Interrogate* button cannot move the badge.** `cardControls` sets `interrogate: underReview` (`packages/domain/src/rules/card-controls.ts:78`), and `PlanCard.tsx:581` renders `InterrogateButton` on a Design card. The route refuses every phase except `draft`: `packages/board/src/server/interrogate.ts:432` `if (phase !== 'draft') refuse('not-a-draft', …)`. `InterrogateButton.tsx:17` says "the plan's `Rounds:` moves, and the card's rounds badge shows it on the next refresh". After this change a Design card shows `not interrogated` beside a button that answers `409 not-a-draft` when a person clicks it. The badge states that an action is owed, and the control offered for it refuses. The issue's premise ("the card offers *Interrogate*") is true of the button and false of the route. The domain rule that records a round accepts Design: `packages/domain/src/transitions/round.ts:156` refuses only the terminal phases. So the route is the one rule of three that reads Draft-only. `interrogate-route.test.ts:151` tests `approved`, `delivered` and `released` and never `design`, so no test pins the Design refusal either way.

2. **A Design count can be stale, and nothing reports it.** `plot-reconcile-scan.sh` §15 reports a plan amended after its last recorded round, and filters `select(.phase == "draft")` (`skills/plot/scripts/plot-reconcile-scan.sh:2077`). Its header says why: "a Draft plan is the one whose card a reader judges by the badge" (around line 2045). Design is the phase where the plan text changes most: the design agent writes `## Design` after a Draft-era interrogation. After the change a Design card shows `2 rounds` for a text that the rounds did not question, and §15 stays silent. The plan does not mention §15.

3. **No automation reads the badge.** `git grep roundsBadge` on origin/main finds it only in `card-controls.ts`, `PlanCard.tsx` (`roundsBadgeText`), `rows.tsx` (through `roundsBadgeText`) and test fixtures. `packages/fleet/src`, the approve path, the sprint scorer and every shell script name it zero times. No approve rule reads `Rounds:` (grep of `packages/domain/src/rules` and `transitions` for `rounds|interrogat` finds only `round.ts`, `panel.ts` and `card-controls.ts`). Auto-design is `false` in this repo's config and reads no rounds field. The change is display-only, as the plan says.

4. **`card.rounds` is already populated for Design plans.** `packages/board/src/server/board.ts:2750` copies `meta.rounds` onto every card regardless of phase, so the Design badge reads the real parsed value, not a default. `0` and absent stay distinct (`roundsBadgeText`, `PlanCard.tsx:223-227`).

5. **The Waiting-on-you row stays Draft-only, and that is consistent.** `draftPlanOf` (`board.ts:2999`) admits `phase === 'draft'` only, and `DraftPlanRowView` renders its own badge from `draft.rounds`. A Design plan has no such row, so no second badge disagrees with the card. The plan's open question about `draft-plan-row.tsx` and `working-agents.ts` resolves to "no change": both serve that Draft-only row.

6. **The test list misses one fixture.** `packages/board/test/integration/spike-card-states.browser.test.ts:20` hand-builds a Design spike card with `interrogate: true, roundsBadge: false`. It keeps passing, and it then encodes the old scope as a fixture. `packages/board/test/fixtures/card-controls.ts` (`controlsFor`) derives from `cardControls`, so every browser fixture with a `Design` column now renders a `not interrogated` badge; any test that counts `[data-plan-rounds]` across columns can change its count.

## Required amendments

A. Decide the *Interrogate* contradiction in the plan, in one of two ways, and name the choice:
   - (preferred) widen `interrogate.ts:432` to accept `design` as well as `draft`, update the refusal detail and the `not-a-draft` row in the table at `interrogate.ts:320`, and add `design` as an accepted phase in `interrogate-route.test.ts` (a test that fails on origin/main: a POST for a Design plan answers 409 today), or
   - keep the route Draft-only and set `interrogate: draft` in `cardControls`, so a Design card offers no button it refuses. This contradicts the issue's premise and needs a person.
   Leaving both as they are ships a badge that names an owed action beside a button that refuses it.

B. Extend `plot-reconcile-scan.sh` §15 to Design plans: `select(.phase == "draft" or .phase == "design")`, and update the section header, its echo line and its "DRAFT PLANS ONLY" comment. This is a one-token change and adds no shell lines, so the shell-lines ratchet holds. Add one case to the §15 test in `test/reconcile/` with a Design plan amended after its round; it fails before the change.

C. Add `spike-card-states.browser.test.ts` to the list of tests to update, and state in the slice that browser fixtures with a Design column now render the badge.

## Decisions for a person

- Amendment A: whether a Design plan may be interrogated from the board. The agent cannot pick between widening the route and removing the button; each changes what a person sees on the card.

## What I ran versus read

Ran (read-only): `git fetch origin main`; `git show origin/main:` on `card-controls.ts`, `PlanCard.tsx`, `rows.tsx`, `draft-plan-row.tsx`, `board.ts`, `interrogate.ts`, `InterrogateButton.tsx`, `round.ts`, `plot-reconcile-scan.sh`, `card-controls-fixture.test.ts`, `plan-rounds-badge.browser.test.ts`, `interrogate-route.test.ts`; `git grep` for `roundsBadge`, `rounds`, `interrogat`, `not-a-draft` across `packages/` and `skills/`; `gh issue view 3088`; `gh pr view 3090`. One grep was refused by the plot controller gate because its pathspec named `plot-approve.sh`; I re-ran it without that path.

Did not run: any test suite, the board, or a POST to `/api/interrogate`. The `not-a-draft` refusal for a Design plan is read from `interrogate.ts:432` and not observed.

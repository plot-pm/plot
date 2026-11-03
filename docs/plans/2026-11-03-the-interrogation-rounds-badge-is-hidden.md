# The interrogation-rounds badge is hidden on Design cards

> A Design card offers *Interrogate* but hides the rounds badge; the badge shows on Draft and Design.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3088
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- The board shows the interrogation-rounds badge (`not interrogated`, `0 rounds`, `2 rounds`) on Design cards as well as Draft cards. An Approved card shows none.

<!-- Board impact: changes `cardControls` in @plot-pm/domain and the card text in packages/board; rebuild the board artifact (pnpm build:board) is done by main after merge. No change to the plan format, template, helper scripts or docs/plans layout. -->

## Motivation

A Design card offers *Interrogate*, and the card hides the record of that action. `cardControls` (`packages/domain/src/rules/card-controls.ts`) sets `interrogate: underReview` (Draft and Design) and `roundsBadge: draft` (Draft only). A plan created directly in Design (`/plot-idea`, design question answered yes) is never shown as `not interrogated` before approval.

`roundsBadgeText` in `PlanCard.tsx` gives the reason as "Past Draft the count is history: approval settled the question it measures". Design comes before approval, so the question is still open there.

Reproduction (issue #3088, Plot 2.30.0): create a plan with the design question answered yes, open the Planning tab. The card shows *Approve* and *Interrogate* and no rounds badge. A Draft plan without `Rounds:` shows `not interrogated` in the same column.

## Design

### Approach

Change one line in `cardControls`: `roundsBadge: underReview`. The badge then shows on every card before Development (Draft and Design) and stays hidden from Approved on.

Update the wording that states the old scope:

- the TSDoc on `cardControls` ("`needsDesign` and `roundsBadge` hold on the `draft` state only" becomes two statements: `needsDesign` holds on Draft, `roundsBadge` holds on Draft and Design),
- the TSDoc on `roundsBadgeText` in `PlanCard.tsx` ("Draft only", "`draft` qualifies and `design` does not").

Tests that assert the old behaviour change with it. Candidates from a grep for `roundsBadge` and `not interrogated`: `packages/domain/test/card-controls.test.ts`, `packages/board/test/unit/rounds-badge.test.ts`, `packages/board/test/unit/card-controls-fixture.test.ts` and `packages/board/test/integration/plan-rounds-badge.browser.test.ts`. The implementer reads each and keeps only the assertions that name Design.

Board impact: the decision stays in the domain (`cardControls`), the component only reads `controls.roundsBadge`, so no `.tsx` logic changes.

### Open Questions

- [ ] Do other surfaces read the Draft-only scope as a fact (`draft-plan-row.tsx`, `rows.tsx`, `working-agents.ts` mention the badge)? The implementer checks each before the change.

## Slices

### Badge on Design cards

- `feature/the-interrogation-rounds-badge-is-hidden` — `cardControls` sets `roundsBadge` for Draft and Design, doc comments and tests follow

## Notes

- Source: tracker issue #3088. Recorded as `Issue:` so the board drops it from the inbox.
- Ceremony: `Review: pr` (Plan PRs are required in this repo); `Impl: own branches`. Design question: not answered in the prompt, so the plan starts in Draft.

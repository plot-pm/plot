# The interrogation-rounds badge is hidden on Design cards

> A Design card offers *Interrogate* but hides the rounds badge, and the route refuses the click; the badge shows on Draft and Design, and the route accepts both.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3088
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3090 merged
- **Started:** 2026-11-03, Jan Wloka, `feature/the-interrogation-rounds-badge-is-hidden`
- **Delivered:** 2026-11-04
- **Released:** 2026-11-07, v2.31.0

## Changelog

- The board shows the interrogation-rounds badge (`not interrogated`, `0 rounds`, `2 rounds`) on Design cards as well as Draft cards. An Approved card shows none.
- `POST /api/interrogate` accepts a Design plan. It still refuses an Approved, Delivered or Released plan with `not-a-draft`.
- `/plot-reconcile` section 15 reports a Design plan amended after its recorded round, as it does for a Draft plan.

<!-- Board impact: changes `cardControls` in @plot-pm/domain, the interrogate route in packages/board/src/server, and comments in packages/board; main rebuilds the board artifact (pnpm build:board) after merge. No change to the plan format, template or docs/plans layout. One helper script changes: plot-reconcile-scan.sh section 15. -->

## Motivation

A Design card offers *Interrogate*, and the card hides the record of that action. `cardControls` (`packages/domain/src/rules/card-controls.ts`) sets `interrogate: underReview` (Draft and Design, `:78`) and `roundsBadge: draft` (Draft only, `:79`). A plan created directly in Design (`/plot-idea`, design question answered yes) never shows `not interrogated` before approval.

`roundsBadgeText` in `PlanCard.tsx` gives the reason as "Past Draft the count is history: approval settled the question it measures". Design comes before approval, so the question is still open there.

The button on a Design card also cannot record a round. `PlanCard.tsx:581` renders `InterrogateButton` on `controls.interrogate`, and `packages/board/src/server/interrogate.ts:432` refuses every phase except `draft` with `409 not-a-draft`. The domain rule that records a round accepts Design: `recordRound` (`packages/domain/src/transitions/round.ts:156`) refuses only the phases in `TERMINAL` (`:111`: delivered, released, rejected, superseded). So the route is the one Draft-only rule of the three. A badge that says `not interrogated` beside a button the server refuses names an action nobody can take from the board.

Reproduction (issue #3088, Plot 2.30.0): create a plan with the design question answered yes, open the Planning tab. The card shows *Approve* and *Interrogate* and no rounds badge. A Draft plan without `Rounds:` shows `not interrogated` in the same column. A click on *Interrogate* answers `409 not-a-draft`.

This reverses the Draft-only scope that PR #1617 recorded for the badge (`packages/board/CHANGELOG.md:1012`: "the interrogation-rounds badge stay[s] on Draft plans only"). That changelog entry is history and stays as written.

## Design

### Approach

**Badge.** Change one line in `cardControls`: `roundsBadge: underReview`. The badge then shows on every card before Development (Draft and Design) and stays hidden from Approved on. The decision stays in the domain; `PlanCard.tsx` (`roundsBadgeText`, `:223-227`) and `rows.tsx:638` read only `controls.roundsBadge`, so no `.tsx` logic changes.

**Route.** `handleInterrogate` (`packages/board/src/server/interrogate.ts:432`) admits `draft` and `design`. It refuses every other phase with the existing reason `not-a-draft`; the reason name stays, so no client or test that reads it changes. The refusal detail says the plan is past Design. These texts change with it:

- the module TSDoc (`interrogate.ts:14` "Interrogating a Draft plan", `:17` "Draft-only"),
- the refusal table row (`interrogate.ts:320` "the plan is past Draft"),
- the prompt in `composeInterrogatePrompt` (`interrogate.ts:196` "on the Draft plan") — it names the plan without a phase,
- the route comment in `packages/board/src/server/index.ts:314` ("a Draft plan is sent to /plot-panel") and `:317` ("Draft-only").

The plan-PR lookup (`resolveInterrogatePlanPr`, `idea/<slug>` open PR, else the main checkout) needs no change: it reads a Design plan the same way.

**Reconcile.** `skills/plot/scripts/plot-reconcile-scan.sh` section 15 filters `select(.phase == "draft")` (`:2076`). It becomes `select(.phase == "draft" or .phase == "design")`. The section's comments and output name Draft and Design plans: the header list entry (`:136`), the section note (`:1994`, and "DRAFT PLANS ONLY" at `:2041-2043`), the echo line (`:2052`), the jq comment (`:2055`) and the none line (`:2079`). Each edit replaces a line in place: the change adds no net shell lines (`scripts/check-shell-lines.sh`) and uses no syntax outside bash 3.2. The section stays below the blocking-sections marker and outside `attention=`.

### Scope boundary

The Agents tab's WAITING ON YOU draft-plan row stays Draft-only. `draftPlanOf` (`packages/board/src/server/board.ts:2998`) admits `meta.phase === 'draft'` only, `draft-plan-row.tsx` renders that list, and `draftRoundsText` (`packages/board/src/app/lib/agent-rows/working-agents.ts:145`) words its badge. None of them reads `controls.roundsBadge`. Do not widen `draftPlanOf`, the `DraftPlan` schema, `DRAFT_PLAN_NOTE` or `draft-plan-row.browser.test.ts`. A Design plan with no branch keeps no WAITING ON YOU row. The Agents-tab plan head (`rows.tsx:638`) calls `roundsBadgeText(card)` and follows the domain change with no edit.

No skill text changes. `skills/challenge-the-plan/SKILL.md` and `skills/plot-panel/SKILL.md` do not restrict a round to Draft.

### Stale comments

Update each comment that states the Draft-only badge:

- the TSDoc on `cardControls` (`card-controls.ts:41-43`): "`needsDesign` and `roundsBadge` hold on the `draft` state only" becomes two statements — `needsDesign` holds on `draft`; `roundsBadge` holds on `draft` and `design`,
- the TSDoc on `roundsBadgeText` (`PlanCard.tsx:212-214`: "Draft only", "`draft` qualifies and `design` does not"),
- the JSX comment in `PlanCard.tsx:436` ("a Discovery-column answer"),
- the header comment in `packages/board/test/unit/rounds-badge.test.ts:10-11` ("a Draft card carries the badge and a Design card does not"),
- the comment in `packages/board/test/integration/plan-rounds-badge.browser.test.ts:183` ("gates on `isDraft` — phase === 'Discovery'"); the badge gates on `controls.roundsBadge`,
- the test title in `packages/board/test/board.test.mjs:534` ("the BADGE is what is Draft-only"); its assertions stay,
- the sentence in `InterrogateButton.tsx` that the button's success shows in the rounds badge stays true and needs no edit.

### Tests

Change the assertions that state Design shows no badge, or that the route refuses Design. Delete nothing else.

Fail on `origin/main`, pass after the change:

- `packages/domain/test/card-controls.test.ts:31` — `roundsBadge holds on draft only: %s` becomes `roundsBadge holds on draft and design: %s`, expects `state === 'draft' || state === 'design'`, and runs over `[...STATES, 'rejected', 'superseded', 'none']`, as the `needsDesign` test at `:23` does.
- `packages/domain/test/card-controls.test.ts:56` — `offers Approve and Interrogate on a Design plan, and not the rounds badge` becomes `offers Approve, Interrogate and the rounds badge on a Design plan` and expects `roundsBadge: true` in its `toEqual`.
- `packages/board/test/unit/rounds-badge.test.ts:54` — `appears only on Draft cards` splits: a `Design` card with `rounds: 3` reads `3 rounds`, and one with no rounds reads `not interrogated`; `Development`, `Testing` and `Released` still read `''`.
- `packages/board/test/unit/interrogate-route.test.ts` — a new case: a POST for a plan whose phase reads `design` is admitted (no `not-a-draft`; it answers as the Draft case does). The refusal loop at `:151` keeps `approved`, `delivered` and `released` and their `not-a-draft` assertions.
- `test/reconcile/scan.test.mjs`, section 15 fixture (`before` at `:2279-2364`) — add a Design plan with `- **Rounds:** 1` that the amendment commit touches. A new test asserts section 15 reports it. The footer test (`:2403-2411`) then expects 3 body findings and `rounds_drift=3`.

Need no assertion change: `packages/board/test/unit/card-controls-fixture.test.ts` (asserts `roundsBadge` for `Discovery` only, `:21`) and `packages/board/test/integration/plan-rounds-badge.browser.test.ts` (no Design card; only the comment at `:183` changes).

Fixture: `packages/board/test/integration/spike-card-states.browser.test.ts:20` hand-writes a Design card's controls with `roundsBadge: false`. Set `roundsBadge: true`, or build the controls through `controlsFor({ phase: 'Design', ... })` from `test/fixtures/card-controls.ts`.

The domain coverage gate (100%, `all: true`) does not move: `draft` stays in use for `needsDesign` (`card-controls.ts:77`).

### Changeset

One changeset, description first, comment block last:

```markdown
---
'@plot-pm/board': patch
'plot': patch
---

The board shows the interrogation-rounds badge on Design cards as well as Draft cards, and `POST /api/interrogate` accepts a Design plan. `/plot-reconcile` section 15 reports a Design plan amended after its recorded round.

<!--
plan: docs/plans/2026-11-03-the-interrogation-rounds-badge-is-hidden.md
-->
```

`'plot': patch` covers `plot-reconcile-scan.sh`. No skill text changes, so the block has no `bumps:` entry. `scripts/check-changeset-packages.sh` reads the allowed names from the workspace `package.json` files; both names are in it.

## Slices

### Badge and route on Design cards

- `feature/the-interrogation-rounds-badge-is-hidden` — `cardControls` sets `roundsBadge` for Draft and Design; the interrogate route admits Design; reconcile section 15 covers Design; comments, tests and the changeset follow → #3104

## Notes

- Source: tracker issue #3088. Recorded as `Issue:` so the board drops it from the inbox.
- Ceremony: `Review: pr` (Plan PRs are required in this repo); `Impl: own branches`. Design question: not answered in the prompt, so the plan starts in Draft.
- Round 1: four-juror panel, `.plot/panels/2026-11-03-the-interrogation-rounds-badge-is-hidden/panel.md`.

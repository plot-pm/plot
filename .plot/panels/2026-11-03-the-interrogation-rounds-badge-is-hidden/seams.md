# Seams juror — the-interrogation-rounds-badge-is-hidden

Position: amend

Read against `origin/main` at `0723f9dd5`.

## Findings

### 1. The Interrogate button on a Design card is refused by the server (the main seam)

- `packages/board/src/server/interrogate.ts:432-438` refuses every phase except `draft` with `not-a-draft`: "plan `<slug>` is design, not draft — a panel on a plan past Draft changes nothing the lifecycle reads". The module TSDoc (`:14`, `:17`) and the route comment in `packages/board/src/server/index.ts:317` both say "Draft-only". The prompt at `interrogate.ts:196` says "Run /challenge-the-plan on the Draft plan".
- `cardControls` sets `interrogate: underReview` (`packages/domain/src/rules/card-controls.ts:78`), and `PlanCard.tsx:581` renders the button on that control. So a Design card shows *Interrogate* today, and a click on it ends in `not-a-draft`.
- The plan's Motivation ("A Design card offers *Interrogate*, and the card hides the record of that action") is true for the rendered control and false for the action. After this plan, a Design card shows `not interrogated` next to a button that cannot change it from the board. The badge then reports an obligation the board refuses to discharge.
- The plan does not mention `interrogate.ts`. Its Open Question lists three client files and not the server route that owns the Design behaviour.

### 2. The Open Question can be settled now, and the answer is known

- `rows.tsx:26,638,834` imports and calls `roundsBadgeText(card)` for the Agents-tab plan head. It reads `controls.roundsBadge`, so it follows the domain change with no edit. The Agents tab then shows the badge for a Design plan head as well. Expected and consistent.
- `draft-plan-row.tsx` and `working-agents.ts:139-146` (`draftRoundsText`) render the WAITING ON YOU row for `draftPlans`. The server fills `draftPlans` from `draftPlanOf` (`packages/board/src/server/board.ts:2998`), which answers only for `meta.phase === 'draft'`. These files do not read `controls.roundsBadge` and do not change. A Design plan with no branch still gets no WAITING ON YOU row; that is a separate gap and out of this plan's scope, and the plan should say so in one line.
- Leaving this as an Open Question for an unattended Sonnet agent invites it to widen `draftPlanOf` to Design, which changes the Agents-tab population and `DRAFT_PLAN_NOTE` wording. Settle it in the plan.

### 3. The test list is partly wrong and partly incomplete

Tests that fail after the one-line change (the agent must change these):

- `packages/domain/test/card-controls.test.ts:31-38` (`roundsBadge holds on draft only`).
- `packages/domain/test/card-controls.test.ts:56-60` (`offers Approve and Interrogate on a Design plan, and not the rounds badge`, `roundsBadge: false`).
- `packages/board/test/unit/rounds-badge.test.ts:52-63` (`appears only on Draft cards`, loops `'Design'` and expects `''`; the fixture maps column `Design` to state `design`, `test/fixtures/card-controls.ts:23-29`).

Tests the plan names that do not fail:

- `packages/board/test/unit/card-controls-fixture.test.ts` asserts only `Discovery` → `roundsBadge: true` (`:21`). No change.
- `packages/board/test/integration/plan-rounds-badge.browser.test.ts` holds no Design fixture; `shipped` is Testing (`:178-196`). Only its comment at `:183` ("gates on `isDraft` — phase === 'Discovery'") is stale.

Fixtures the plan misses:

- `packages/board/test/integration/spike-card-states.browser.test.ts:20` hard-codes a Design card's controls with `roundsBadge: false`. It keeps passing, and it then contradicts the domain. Replace it with `controlsFor({ phase: 'Design', ... })` or set `roundsBadge: true`.

No test proves the new behaviour is SEEN. CLAUDE.md "Every rendered state is a domain property" asks for one browser assertion that the badge renders. Add a Design fixture to `plan-rounds-badge.browser.test.ts` (no `Rounds:` → `not interrogated`), or state why the unit test suffices.

### 4. Docs and comments that state the Draft-only scope

- `card-controls.ts:41-43` and `PlanCard.tsx:210-214` — the plan names both. Correct.
- `PlanCard.tsx:434-437` JSX comment ("a Discovery-column answer") — not named; reword to "Draft and Design".
- `rounds-badge.test.ts:11-12` header comment ("a Draft card carries the badge and a Design card does not") — not named.
- `plan-rounds-badge.browser.test.ts:183-187` — see above.
- `packages/board/CHANGELOG.md:1012` (#1617) states "the interrogation-rounds badge stay[s] on Draft plans only". This is history and stays; the new changeset supersedes it. It does show the Draft-only scope was a deliberate decision in #1617, and the plan should name that it reverses it.
- Skills: `skills/challenge-the-plan/SKILL.md`, `skills/plot-panel/SKILL.md:27,173` and `skills/plot/templates/plan.md:14` describe `Rounds:` and the badge without a phase scope that this change contradicts. `plot-panel/SKILL.md:173` says "A panel on a Draft plan IS a round"; it does not say a Design plan cannot have one. No skill edit is required. No skill changes, so no skill `bumps:` entry.

### 5. Changeset

- The plan has no changeset line. The change is user-visible on the board, so it needs one. `scripts/check-changeset-packages.sh` derives valid names from workspace `package.json` files; CLAUDE.md › Versioning names `plot` and `@plot-pm/board`. The precedent for this exact control set (#1617) shipped under `@plot-pm/board` (`packages/board/CHANGELOG.md:1012`).
- Required: `'@plot-pm/board': patch`, description first, `plan: docs/plans/2026-11-03-the-interrogation-rounds-badge-is-hidden.md` in the trailing comment block, no `bumps:` skills entry.

### 6. Sprint goal

The change does not move the fleet toward zero interventions; it is a display fix. It costs one small slice and touches no gate, script, shell line, bash 3.2 code or Bitbucket arm. With finding 1 unresolved it adds a visible prompt ("not interrogated") that a person cannot act on from the board, which is a small step away from the goal.

## Amendments required

1. Settle finding 1 in the plan, by one of these (a person chooses, see below):
   - (a) Widen `interrogate.ts:432` to accept `draft` and `design`, rename or keep the `not-a-draft` refusal for Approved onward, update `interrogate.ts:14,17,196`, `index.ts:317` and the refusal table at `:320`, and add a server test that a Design plan is accepted and an Approved plan is refused. This keeps one slice; it touches `packages/board/src/server`.
   - (b) Keep the route Draft-only and set `interrogate: draft` in `cardControls`, so a Design card offers neither the button nor the badge. This contradicts issue #3088's expectation.
   - (c) Ship the badge only, and file a follow-up issue for the refused button, named in `## Notes`.
2. Replace the Open Question with the answer in finding 2: `rows.tsx` follows through `roundsBadgeText`; `draft-plan-row.tsx` and `working-agents.ts` stay Draft-only because `draftPlanOf` stays Draft-only; widening `draftPlanOf` is out of scope.
3. Replace the test list with the exact list in finding 3: the three failing tests, the `spike-card-states.browser.test.ts:20` fixture, the stale comments, and one new Design case (unit in `rounds-badge.test.ts` and `card-controls.test.ts`; browser in `plan-rounds-badge.browser.test.ts`).
4. Add the comment sites in finding 4 to the "update the wording" list.
5. Add the changeset in finding 5 to the slice line.

## Decisions for a person

- Finding 1: is a Design plan interrogatable from the board (a), or is Interrogate on a Design card the defect (b), or is that deferred (c)? #1617 chose Draft-only for the badge and for `needsDesign`, and `interrogate.ts` chose Draft-only for the action; the issue reverses one of the three. This is a product decision, not an agent's.

## What I ran versus read

- Ran: `git fetch origin main`; `git grep` over `origin/main` for `roundsBadge`, `not interrogated`, `Draft only`, `draftPlans`, `rounds`, `changeset`; `git show origin/main:<file>` for every file cited; `gh issue view 3088`; `gh issue list --search "interrogate design"` (no related issue found).
- Read only: every file:line above. I ran no test suite, no build and no board or fleet command, so the "fails after the change" claims in finding 3 come from reading the assertions against the fixture mapping, not from a run.

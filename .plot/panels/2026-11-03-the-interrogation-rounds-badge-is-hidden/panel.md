# Panel — the interrogation-rounds badge is hidden

Subject: `docs/plans/2026-11-03-the-interrogation-rounds-badge-is-hidden.md` (plan PR #3090, issue #3088)
Convened: 2026-11-03, round 1, against `origin/main` at `0723f9dd5`
Lenses: layering, safety, testability, seams — four jurors, one rubric, persona varied only.

## Outcome: UNANIMOUS — 4 amend

| Lens | Position | Evidence |
|---|---|---|
| layering | **amend** | read only |
| safety | **amend** | read only |
| testability | **amend** | read only |
| seams | **amend** | read only |

All four gated with a committed position. Reconcile: `unanimous amend layering,safety,testability,seams`.

## Agreement across all four

1. **The decision lives in the domain, and the one-line change is correct.** `cardControls` (`packages/domain/src/rules/card-controls.ts:79`) sets `roundsBadge: draft`; `roundsBadgeText` (`PlanCard.tsx:223-227`) and `rows.tsx:638` only read `controls.roundsBadge`. No `.tsx` logic changes.
2. **The open question delegates a scope decision and must close in the plan.** The WAITING ON YOU row (`draftPlanOf`, `board.ts:2998`; `draft-plan-row.tsx`; `draftRoundsText`, `working-agents.ts:145`) is Draft-only and reads no control flag. Left open, an unattended agent can widen `draftPlanOf`.
3. **`spike-card-states.browser.test.ts:20` hand-writes a Design card with `roundsBadge: false`.** It stays green and then contradicts the domain. Set it to `true` or build it with `controlsFor`.
4. **"Keeps only the assertions that name Design" reads as a deletion instruction.** The intended meaning is: change the assertions that state Design shows no badge.

## Findings from some jurors only

- **The route refuses Design (safety, seams).** `interrogate.ts:432` refuses every phase except `draft` with `not-a-draft`, while `round.ts:156` refuses only `TERMINAL` phases (`:111`). A Design card would show `not interrogated` beside a button the server refuses. Layering and testability did not read the route.
- **Reconcile section 15 is Draft-only (safety).** `plot-reconcile-scan.sh:2076` filters `select(.phase == "draft")`, so a stale Design round stays silent. Verified on `origin/main`.
- **Named fail-before tests (layering, testability, seams).** `card-controls.test.ts:31` and `:56`, `rounds-badge.test.ts:54`. Testability adds that the `roundsBadge` loop runs over the wider state list, as the `needsDesign` test does.
- **No assertion change for `card-controls-fixture.test.ts` and `plan-rounds-badge.browser.test.ts` (layering, testability, seams).**
- **Stale comments beyond the two TSDoc blocks (layering, seams).** `PlanCard.tsx:436`, `rounds-badge.test.ts:10-11`, `plan-rounds-badge.browser.test.ts:183`, and the reversal of #1617 (`packages/board/CHANGELOG.md:1012`).
- **A changeset (seams).** `'@plot-pm/board': patch` with a `plan:` line.
- **A browser test that sees the Design badge (seams only).** Not adopted: the render path is the same for Draft and Design (`PlanCard.tsx:451`), and testability argued that the unit tests suffice. The operator's test list names no new browser test.

## Shared blind spots

- **No juror ran anything.** Every "fails after the change" claim comes from reading assertions against the fixture mapping. No test ran before or after.
- **Two of four did not read the route.** Layering and testability treated the button as given; only the two jurors that read `interrogate.ts` found that it refuses Design.
- **No juror checked other stale wording in tests.** `board.test.mjs:534` names the badge "Draft-only" in a test title; the moderator found it while verifying and added it to the plan.

## Operator decisions

1. The interrogate route accepts Design and refuses Approved and later with the existing `not-a-draft` reason. A new route test that fails on `main` admits a Design plan.
2. `roundsBadge: underReview` in `cardControls`.
3. The WAITING ON YOU draft-plan row stays Draft-only and is out of scope.
4. Reconcile section 15 covers Design plans, with a test, within the shell-lines ratchet and bash 3.2.
5. The plan names the exact test list, including the `spike-card-states` fixture.
6. The plan lists the stale comments and notes the reversal of #1617.
7. One changeset: `'@plot-pm/board': patch` and `'plot': patch` (the reconcile script changes), `plan:` line, no skill bumps.
8. One slice, one branch: `feature/the-interrogation-rounds-badge-is-hidden`.

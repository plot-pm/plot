# Panel moderation, round 3: templates-show-named-identifiers

Reconcile answer: **unanimous** `amend` (estate, contradiction, deliverable, cost). Siblings read: 8 of 8 unfinished plans in `docs/plans/active/`, 0 unread; no sprint holds this plan.

## What each juror looked at

- **Estate** ran `grep` over `skills/`, `docs/stories`, `docs/plans`, and read `test/reconcile/` for tests that parse the templates.
- **Contradiction** read `scripts/check-*.sh`, the tests that read the templates, `plot-init/SKILL.md`, and the 8 sibling plans.
- **Deliverable** opened every named file and line reference, and read the D3, D5, D10 and D14 definitions in the archived story.
- **Cost** read `plot-init/SKILL.md`, the skill READMEs and the Versioning rule.

All four read files and ran `grep`. None ran a test or the board.

## New findings (written as Open Points)

1. D10's definition is mainly about the fleet commissioning a spec for a Design plan; "a person approves" is its last sentence. Both proposed names fit only that sentence (deliverable, misleads).
2. Tests read the plan templates (`parser.test.mjs:2593-2605`, `skills-say-slices.test.mjs:63,83`, `approve-record-outside-comments.test.mjs:46`, `started-record-outside-comments.test.mjs:3`). The Notes name only `story-record.ts` (estate, misleads).
3. `plot-init/SKILL.md:605-606` copies the shipped plan template once into an adopter's `.plot/templates/plan.md`; an existing adopter's copy never receives the change (contradiction and cost, misleads).
4. `interrogate.ts:39` and `contract/schema.ts` also read Open Points; they join the reader check in `[question-open-points-row-text]` (estate, cosmetic).

## Disagreement to name

The estate and cost jurors counted legend-bound D-codes differently: 24 files under `docs/stories` and `docs/plans` (estate) against 41 files that include `skills/` (cost). Both are `grep` counts over different path sets, not a contradiction about the code. `[question-adopter-evidence]` needs one stated path set and one number.

## Shared blind spot

All four jurors read the plan as text. No juror tested the central claim of the Motivation: that a named identifier reads better than "D14" for an agent that writes the next plan. The plan offers one measured case and no evidence on the agent's behaviour. The three round-2 questions on uniqueness, first-token shape and the challenge skill's own lines stay open and no juror touched them.

## Position

Nothing is approved, rejected or moved. The plan stays Draft with 15 Open Points.

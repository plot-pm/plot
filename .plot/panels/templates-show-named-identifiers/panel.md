# Panel moderation: templates-show-named-identifiers

Reconciliation: unanimous `amend` (estate, contradiction, deliverable, cost). Round 1, unattended; four jurors, each read the plan and the files it names, and none ran code. Siblings: the active sprint `bug-fixes-2-35-0` has all items done and does not list this plan, so the three other plans in `docs/plans/active/` served as context. No sibling touches the templates.

## Where the jurors agree

1. **The name for D10 is too broad.** `[decision-person-approves-plans]` says a person approves every plan. D10 and `plot-approve/SKILL.md:124-128` say it for a Design plan only. Estate and contradiction propose `[decision-person-approves-design-plans]`. Deliverable finds the name matches only the last clause of the definition.
2. **Two refusal messages in board code still print "(D10)":** `packages/board/src/server/approve.ts:332` and `entry/approve.ts:1060`; `approve.test.mjs:359` asserts that text. `auto-deliver.ts:325` cites D14. The plan names neither as in or out of scope, so an operator would see the code in the message and the name in the skill. Three jurors name it.
3. **The plan's `Board impact: none` is false for the Open Points line** (contradiction, cost). `planOpenQuestions` (`packages/domain/src/rules/plan-open-questions.ts:7-43`) passes the first unchecked item to `draft-plan-row.tsx:64-67`, which shows it as raw, truncated text. A `` `[question-…]` `` prefix takes the space the question needs.

## Findings held by one lens

- **Estate:** `gate.ts:438` uses "D14" for a state-ref decision that is not the archived story's D14. The Motivation can cite it as a measured fact of the ambiguity.
- **Contradiction / deliverable:** `plot-idea/SKILL.md:281` cites D3 "in `DESIGN-phases.md`", and that file will not hold the new name; the plan leaves the design doc's citations alone. The reader follows the name to a file that does not define it.
- **Contradiction:** step 2 does not say whether the identifier replaces or follows the `⏸️`/`✅` markers on an Open Points bullet.
- **Deliverable:** the Changelog omits the `story-tracking/SKILL.md` wording and the edit to the archived story's Decisions table. Other skill text cites codes the plan misses: `plot-host.sh` comments cite D20, D23 and a D6 from a different plan.
- **Cost:** a change under `skills/plot/templates/plan.md` selects every CI job (`ci-selection-jobs.test.mjs:128-133`), and the one changeset carries five skill bumps the plan does not list.

## What the lenses shared

All four read text and grep results; none rendered a board row or ran the gates. Item 3 is therefore a reading of the code path, and the truncation width is unmeasured. All four also took the four codes as the full set to rename; the deliverable juror alone searched for more, and only under `skills/`.

## Not acted on

The panel recorded no decision on the plan's phase. Nothing is approved or rejected, and no phase moved.

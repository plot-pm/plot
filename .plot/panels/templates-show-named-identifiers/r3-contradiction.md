# Juror r3: contradiction

## Claim tested

"Board impact: none", "no gate, no config key, no lint finding", and "no parser depends on the changed lines" (plan lines 18, 26, 66), plus agreement with siblings, CLAUDE.md and the manifesto.

## Checked, no contradiction found

- Gates: `scripts/check-plan-headings.sh` greps only `## Branches`/`## Waves` in `docs/plans/*.md`. It reads no template and no Open Points text. No `scripts/check-*.sh` I opened parses template content.
- Tests that read the templates: `test/reconcile/skills-say-slices.test.mjs:83-89` asserts only `^## Slices$` in both plan templates. `config.test.mjs:153-168` tests the `Plan template` config key, not the text. Neither touches `### Open Points`/`### Open Questions`. The shipped-template and local-template headings are unchanged by the plan.
- CLAUDE.md "Project-Agnostic Design" and the manifesto: the plan adds a default in a template and no gate, key or check. That agrees with "Plot discovers and adapts, never enforces".
- Siblings (8 other active plans): none edits `skills/plot/templates/plan.md`, `.plot/templates/plan.md`, `STORY-template.md`, or the three skills' D-code lines. No file overlap, so no merge conflict and no decision in a sibling that this plan reverses. No sibling uses the `[kind-name]` form either (they use bold-lead prose bullets), so the convention is new, not a restatement.
- The `Board impact: none` comment (line 18) still contradicts `plan-open-questions.ts:9` and `draft-plan-row.tsx:64-67`. That is already held by `[question-open-points-row-text]`. I add nothing to it.

## New findings

1. **Comment in a test constrains the local template (cosmetic).** `skills-say-slices.test.mjs:86` says the local `.plot/templates/plan.md` "is the reference, and it is NOT this branch's to change". That comment is scoped to the older slices-vocabulary branch and no assertion enforces it, so it does not block this plan. A builder who reads it may hesitate to edit `.plot/templates/plan.md` (Approach step 1). Not a plan defect. No amendment needed.
2. **Template change reaches adopters only at `plot-init` (misleads, mild).** `skills/plot-init/SKILL.md:605` copies `skills/plot/templates/plan.md` to `.plot/templates/plan.md` once and adapts it. The convention therefore reaches no existing adopter's template. The Motivation says "the templates are where an agent learns the shape", which holds only for new adopters and for this repository. The plan does not say that existing adopter copies stay unchanged. This is the same family as `[question-adopter-evidence]`, but it is a distinct fact: reach, not demand. Suggested: one sentence in Notes.
3. **Plan's own Open Points already break its stated convention.** Line 45 uses `[question-d10-name-scope]` and line 52 uses `[question-design-doc-citations]` as a lead token, then a sentence, which is the shape `[question-checklist-line-first-token]` asks about. Line 53 and the rest follow the same shape. No contradiction, only evidence that the "name then sentence" shape is already de facto. Cosmetic.

## Severity

All three are cosmetic or mild. None blocks. Nothing here contradicts a gate, a test, CLAUDE.md or a sibling plan. The only live contradiction (board impact) is already an Open Point.

## Amendment before approval

Only what the Open Points already require, plus optionally one Notes sentence for finding 2. No new blocker.

Position: amend

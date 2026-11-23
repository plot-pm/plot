# Juror: estate (round 3)

## Claim tested
"The four D-codes are the only legend-bound citations in skill text, and the convention is new."

## Findings (checked against the repo at this worktree)
1. Skill-text count holds. `grep -E '\bD[0-9]{1,2}\b'` over `skills/**/SKILL.md` gives exactly four prose citations: `plot-idea/SKILL.md:281` (D3), `plot-approve/SKILL.md:128` (D10), `plot-deliver/SKILL.md:580` (D14) and `:612` (D5, D14). `plot/SKILL.md:122-123` is Mermaid node names (D, D2), not citations. The only other hits in skills/ are `plot-host.sh:5197,5253,5256,5548` (D20, D23, D6), already held by `[question-other-cited-codes]`. Not new.
2. The convention is new. No `[decision-`, `[question-`, `[risk-`, `[bug-` or `[task-` identifier exists in `skills/`, `docs/stories/`, `docs/plans/` (other than this plan) or `.plot/templates/`. No sibling plan touches the plan or story template. No duplication.
3. Legend-bound codes are already widespread in docs: 24 files under `docs/stories` and `docs/plans` match `\bD[0-9]{1,2}\b`, and the archived story alone carries 71 and 59 D-references in its STORY and DESIGN files. The plan changes four skill lines and leaves the pattern in the estate. This is data for `[question-adopter-evidence]`, which asks for the count; the answer is 24 files. Not a new finding.
4. NEW (misleads): two tests parse the plan templates. `test/reconcile/parser.test.mjs:2593-2605` runs `plot-plan-meta` over both `.plot/templates/plan.md` and `skills/plot/templates/plan.md` and asserts they declare no `agent:`/branches. `test/reconcile/skills-say-slices.test.mjs:63,83` and `approve-record-outside-comments.test.mjs:46`, `started-record-outside-comments.test.mjs:3` read the shipped template. A `[question-…]` placeholder plus a comment line in the template falls under those tests. The plan's Notes say "no parser depends on the changed lines" and name only `story-record.ts`; the template-reading tests are not named, so the claim is unverified for the plan template. Severity: misleads (the claim is probably true, but the plan does not show it was checked).
5. NEW (cosmetic): `packages/board/src/server/interrogate.ts:39` and `packages/board/src/contract/schema.ts` also name "Open Points" (the interrogate flow reads the section). The plan's Board impact comment cites only `story-record.ts`; round 1 already proved the comment false through `planOpenQuestions`, so this is one more reader to check when `[question-open-points-row-text]` is resolved.
6. The skill `challenge-the-plan` and the `.plot/templates/plan.md` (`### Open Questions`) heading differ from the skills template (`### Open Points`); the plan handles this in step 1. Confirmed accurate.

## Severity summary
- Finding 4: misleads. Finding 5: cosmetic. No finding blocks.

## Amendment
The plan needs one amendment before approval: either add the template-reading tests (finding 4) to Notes with the result of running them, or name them in a new Open Point. The round-1 and round-2 Open Points already hold the rest, and they must be resolved or declared out of scope before approval.

Position: amend

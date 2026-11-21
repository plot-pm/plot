# Juror r3: cost

Claim tested: "Board impact: none", "one changeset", `Type: docs` (proportionate cost). Round-1 cost findings (planOpenQuestions, full CI selection, five bumps, kept refusal text) are all held by Open Points `[question-open-points-row-text]`, `[question-changelog-and-cost-honesty]` and `[question-board-messages-keep-codes]`. I do not repeat them. The `Board impact: none` comment still stands in the plan text, but the Open Point names it false.

## New findings

1. **Adopters' copied templates do not receive the change (misleads).** `skills/plot-init/SKILL.md:605-606` copies `skills/plot/templates/plan.md` to `.plot/templates/plan.md` once, "adapted". An adopter that ran plot-init earlier keeps the old template. The shipped bump reaches only new adopters and this repo's own copy. The plan says nothing about this; the Changelog line "the templates show a named identifier" is true for `skills/` only. Cost: the convention spreads by skill text (`story-tracking`, cited decisions) but not by the plan template for existing adopters. Severity: misleads. Amendment: one sentence in Notes that existing `.plot/templates/plan.md` copies are not touched.

2. **Cost of existing plans and stories is zero, and the plan does not say so (cosmetic).** The convention changes only the template placeholder lines and adds no gate, so no existing plan or story drifts or fails. The plan states "existing stories stay valid" for the story table only. Measured here: 41 files under `docs/plans`, `docs/stories` and `skills` match `\bD[0-9]{1,2}\b`, all untouched by the plan. That number is the evidence `[question-adopter-evidence]` asks for, and it is cheap to count (one grep), so the plan could close that Open Point rather than carry it.

3. **Five bumps is proportionate only if levels are stated (cosmetic).** Four of the five bumps (`plot-deliver`, `plot-approve`, `plot-idea`, `plot`) change wording or a placeholder; `story-tracking` adds a convention. `CLAUDE.md` Versioning gives patch for wording, minor for a new pattern. Each bump costs one changelog entry and a release-PR line, not a CI job beyond the full selection already noted. Versions have drifted since round 1 (`plot-approve` is now 2.11.2, `skills/plot-approve/SKILL.md:13`), so the plan must not hard-code a version; it does not.

4. **No README or MANIFESTO obligation found (checked, nothing).** `skills/plot-deliver/README.md` and `skills/plot-approve/README.md` contain no D-code; `skills/plot/changelog.md` contains none. The "root README skills table in sync" rule is not triggered by wording changes.

## Severity
Finding 1 misleads; findings 2 and 3 cosmetic; none blocks. The plan is honest about its direct blast radius only through Open Points, not in its Changelog or Notes.

## Amendment
Yes, before approval: fold the already-recorded cost answers (bump count and levels, full CI selection, the false `Board impact: none`) from Open Points into Changelog/Notes, and add finding 1's sentence.

Position: amend

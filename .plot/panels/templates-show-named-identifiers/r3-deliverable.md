# Round 3, juror: deliverable

## 1. Claim tested
Every slice names something that ships, and the Changelog matches what the slice builds. Checked against the worktree.

## 2. Verified as stated (no finding)
- All named files exist: `skills/plot/templates/plan.md`, `.plot/templates/plan.md` (both tracked), `skills/story-tracking/STORY-template.md`, `skills/story-tracking/SKILL.md`, the three skill files, and `docs/stories/archived/plot-works-in-five-phases/` (STORY + DESIGN-phases.md).
- Anchors exist: plan template `### Open Points` at `skills/plot/templates/plan.md:36` with `- [ ] ...` at :38; `.plot/templates/plan.md:56` `### Open Questions`, placeholder :58; story template `## Open Points` :48 with `⏸️`/`✅` bullets, `## Decisions` table :53-57; `story-tracking/SKILL.md:206-215` "Updating Stories" is the place for the two sentences.
- Plan's line refs still correct: `plot-approve/SKILL.md:124-128` (the "(D10)" is at :128), `plot-idea/SKILL.md:281` ("D3 in `DESIGN-phases.md`").
- Citations in skill text: `plot-deliver/SKILL.md:580` "(decision D14)" and :612 "(decisions D5 and D14)"; `plot-approve/SKILL.md:128`; `plot-idea/SKILL.md:281`. These are the only D3/D5/D10/D14 hits in those three files. The Changelog's "plot-deliver, plot-approve, plot-idea" matches.
- Definitions in `STORY-plot-works-in-five-phases.md`: D3 :79, D5 :81, D10 :86, D14 :90. The names D3, D5 and D14 fit their definitions. Each cell begins "Dn. ..." so a name can follow the code.

## 3. New findings
A. [misleads] The D10 definition (`STORY-plot-works-in-five-phases.md:86`) says the fleet commissions an agent to write a spec for a Design plan with an empty spec, and a spike dispatch follows a person's approval; "Approval stays a person's act" is its last sentence. The plan's name `[decision-person-approves-plans]` and the proposed `...-design-plans` both name only the closing sentence. The Open Point `question-d10-name-scope` raises scope but not that the definition is mainly about fleet spec commissioning. A name that does not fit its definition recreates the legend problem. Amend: base the name on the definition's subject, or cite D10 in `plot-approve` by its sentence ("a person approves a Design plan") with the name tied to that clause.
B. [cosmetic] `plot-deliver/SKILL.md:580,612` and the story's own Decisions table (:90) carry the D14 text; Approach item 4 says the table "gets the name after the code at each of the four definitions" but no slice line or Changelog line lists the archived-story edit. Open Point `question-changelog-and-cost-honesty` holds the Changelog omission; the slice line (plan:62) also omits it and the story-tracking wording. That is the same gap on a second line, not a new problem.
C. [cosmetic] The story's line 58 and line 120 (`| ... | D3, D10 | — |`) cite codes outside the Decisions table; the plan says the codes stay. Consistent, no finding.

## 4. Amendment needed?
Yes, small: resolve A before approval; the 11 Open Points already hold the rest of the deliverable gaps (Changelog and slice-line honesty, citation target file). No slice names a file that does not exist; no line reference is stale.

Position: amend

# Templates show named identifiers

> The plan and story templates show a named identifier for an item that other places refer to, and the skill text names the decisions it cites instead of "D14".

## Status

- **State:** Approved
- **Type:** docs
- **Sprint:** delivery-ui-polish
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 3
- **Approved:** 2026-11-21, jwloka, in-session
- **Started:** 2026-11-21, Jan Wloka, `docs/templates-name-their-identifiers`

## Changelog

- The plan template's Open Points and the story template's Open Points and Decisions show a named identifier with a short prefix for its kind, such as `[decision-fleet-writes-design-specs]` or `[question-…]`, for an item that another place refers to. The convention is a default, not a check: a repository with its own identifier style keeps it.
- The skills `plot-deliver`, `plot-approve` and `plot-idea` name the design decisions they cite instead of citing "D14", "D10", "D5" and "D3". The board's refusal messages for an approval and a delivery name the decision too.
- The `story-tracking` skill tells an agent to give a referenced decision or question a named identifier, and `challenge-the-plan` writes its Open Points lines with one.
- A Draft plan row on the board shows an Open Points line without its leading identifier.
- The archived story `plot-works-in-five-phases` shows the name beside each of the four codes in its Decisions table.

<!-- Board impact: yes. `planOpenQuestions` drops a leading `[kind-name]` token before a Draft plan row shows the line (`draft-plan-row.tsx:64-67`). The refusal messages in `approve.ts` and `entry/approve.ts` and `auto-deliver.ts` change wording. No parser reads a Decision cell; `story-record.ts` checks only that `## Open Points` exists. -->

## Motivation

A reader of a skill, a plan or a story cannot resolve a code such as "D14" without the table that defines it, and that table is in another file. `plot-deliver/SKILL.md` cites "(decision D14)" and "(decisions D5 and D14)"; the definitions are in the Decisions table of the archived story `plot-works-in-five-phases`. An agent that writes a plan copies the habit, and the next reader needs the legend again.

A descriptive name in square brackets, as inline code, reads without a legend: `[decision-person-delivers-lone-tracer]` instead of "D14". A short prefix for the kind (`decision-`, `question-`, `risk-`, `bug-`, `task-`) tells the reader what the item is before the name does. The templates are where an agent learns the shape of a plan and a story, so they are where the convention takes effect.

Adopters have different tastes, so Plot adds no gate, no config key and no lint finding. A repository that numbers its items keeps doing so.

## Design

### Approach

1. **Plan templates.** `skills/plot/templates/plan.md` (`### Open Points`) and `.plot/templates/plan.md` (`### Open Questions`) show `[question-…]` on the placeholder line, with one comment line: a point that another place refers to gets a name with a short prefix for its kind, not a number.
2. **Story template.** `skills/story-tracking/STORY-template.md`: the `## Open Points` bullets start with `[question-…]`, and `[decision-…]` starts the Decision cell. The table keeps its three columns, so existing stories stay valid.
3. **story-tracking skill.** Two sentences where `SKILL.md` describes updating the story file: give a decision or question that another place refers to a descriptive name with a short prefix for its kind (`decision-`, `question-`, `risk-`, `bug-` for a defect, `task-`), in square brackets, as inline code; a repository with its own identifier style keeps it.
4. **Cited decisions.** The four codes in skill text get names from their definitions in `docs/stories/archived/plot-works-in-five-phases/`:
   - D3 → `[decision-person-decides-design]` (`plot-idea/SKILL.md`)
   - D5 → `[decision-tracer-is-a-full-plan]` (`plot-deliver/SKILL.md`)
   - D10 → `[decision-fleet-writes-design-specs]` (`plot-approve/SKILL.md`), named after the definition's subject (`STORY-plot-works-in-five-phases.md:86`). The citation says that approval stays a person's act.
   - D14 → `[decision-person-delivers-lone-tracer]` (`plot-deliver/SKILL.md`)

   The story's Decisions table gets the name after the code at each of the four definitions. The codes stay there, because the story's own files cite them.

5. **Board row text.** `planOpenQuestions` (`plan-open-questions.ts`) drops one leading `[kind-name]` token before it returns the first unchecked line, with a unit test for a named line, an unnamed line and a bare name. The "n open" count stays a count of unchecked lines. `interrogate.ts:39` and `contract/schema.ts`, which also name Open Points, are checked for the same token and changed only where they show the line.
6. **Refusal messages.** `approve.ts:332` and `entry/approve.ts:1060` print the decision name instead of "(D10)", `approve.test.mjs:359` asserts the name, and `auto-deliver.ts:325` names D14's decision. `gate.ts:438` uses "D14" for a different decision; it gets that decision's own name.
7. **challenge-the-plan.** `challenge-the-plan/SKILL.md:514-525` and `:630` write deferred items and contradictions as `- [ ] [question-<name>] <question>` lines.
8. **The shape of a named point.** A named Open Points line is the marker (`⏸️`/`✅`, where present), then `[kind-name]`, then the sentence: `- [ ] ⏸️ [question-name] <question>`. A name is unique within its plan or story, and once another place cites it, it stays fixed when the wording changes. The template comment states both rules.

### Open Points

- [x] `[question-adopter-evidence]` Legend-bound codes appear in 16 plans, 6 files under `skills/plot`, 2 stories and 2 other skills; the habit spreads, so the convention goes ahead. (operator decision, 2026-11-21)
- [x] `[question-adopter-evidence-path-set]` Moot after `[question-adopter-evidence]`. Both counts stand with their path sets: 24 files under `docs/stories` and `docs/plans`, 41 with `skills/` added (panel round 3). (operator decision, 2026-11-21)
- [x] `[question-d10-name-scope]` and `[question-d10-name-fits-definition]` D10 is named `[decision-fleet-writes-design-specs]`, after the definition's subject. (operator decision, 2026-11-21)
- [x] `[question-board-messages-keep-codes]` In scope: Approach step 6. (operator decision, 2026-11-21)
- [x] `[question-open-points-row-text]` The row strips the identifier: Approach step 5. (operator decision, 2026-11-21)
- [x] `[question-citation-target-file]` The D3 citation names the archived story's Decisions table. (operator decision, 2026-11-21)
- [x] `[question-marker-and-name-order]` The identifier follows the marker: Approach step 8. (operator decision, 2026-11-21)
- [x] `[question-changelog-and-cost-honesty]` The Changelog names all changes, and Notes state the five skill bumps and the full CI run. (operator decision, 2026-11-21)
- [x] `[question-other-cited-codes]` `gate.ts:438` is in scope (Approach step 6). The `plot-host.sh` comments citing D20, D23 and another plan's D6 stay as they are, named here as out of scope. (operator decision, 2026-11-21)
- [x] `[question-design-doc-citations]` `DESIGN-phases.md` keeps its codes, because it sits beside the table that defines them. (operator decision, 2026-11-21)
- [x] `[question-name-uniqueness-and-rename]` A name is unique per plan or story and stays fixed once cited: Approach step 8. (operator decision, 2026-11-21)
- [x] `[question-checklist-line-first-token]` An open point is a name followed by its question. A bare name still counts as open, and the template shows the full shape. (operator decision, 2026-11-21)
- [x] `[question-challenge-skill-writes-points]` `challenge-the-plan` adopts the convention: Approach step 7. (operator decision, 2026-11-21)
- [x] `[question-template-reading-tests]` The slice runs the four tests that read the templates, and the PR records the result. (operator decision, 2026-11-21)
- [x] `[question-existing-adopter-templates]` An adopter's copy of the template keeps its text; Notes say so, and nothing changes it. (operator decision, 2026-11-21)
- [x] `[question-interrogate-reads-open-points]` `interrogate.ts:39` and `contract/schema.ts` join the readers in Approach step 5. (operator decision, 2026-11-21)

## Slices

### Templates and skill text

- `docs/templates-name-their-identifiers` — plan and story templates, story-tracking wording, four named decision citations, one changeset

## Notes

- `Impl:` reads `own branches` and `Review:` reads `in-session` since 2026-11-21. The plan reached main through its plan PR #3478, which merged from `docs/templates-show-named-identifiers`, so the slice takes the new branch `docs/templates-name-their-identifiers`; a slice on the merged branch would read as complete. The operator reviewed all 17 open points in session on 2026-11-21, and `plot-approve` cannot find #3478 because it reads only the newest 100 merged PRs.
- No parser reads a Decision cell, and `packages/domain/src/rules/story-record.ts` tests only for the heading `## Open Points`. `planOpenQuestions`, `interrogate.ts` and `contract/schema.ts` read Open Points lines (Approach step 5).
- Four tests read the plan templates and run in the slice: `parser.test.mjs:2593-2605`, `skills-say-slices.test.mjs:63,83`, `approve-record-outside-comments.test.mjs:46` and `started-record-outside-comments.test.mjs:3`.
- Cost: the changeset bumps six skills (`plot`, `plot-approve`, `plot-deliver`, `plot-idea`, `story-tracking` and `challenge-the-plan`), and a change under `skills/plot/templates/plan.md` selects every CI job (`ci-selection-jobs.test.mjs:128-133`).
- `plot-init/SKILL.md:605-606` copies the shipped plan template once into an adopter's `.plot/templates/plan.md`. An existing adopter's copy keeps its text; the convention is a default for new adopters.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 3,
  "questionHistory": [
    {"q": "Panel round 1 (estate, contradiction, deliverable, cost): unanimous amend; findings recorded as Open Points", "a": "unattended, no answers", "category": "panel"},
    {"q": "Interview round 2 (unattended): name uniqueness and rename, first-line token against planOpenQuestions, challenge-the-plan skill's own Open Points lines, adopter evidence", "a": "unattended, no answers; recorded as Open Points", "category": "domain"},
    {"q": "Panel round 3 (estate, contradiction, deliverable, cost): unanimous amend; five new Open Points (D10 name fit, template-reading tests, existing adopter templates, interrogate readers, adopter count path set)", "a": "unattended, no answers", "category": "panel"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": false, "implementation": true},
    "domain": true,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

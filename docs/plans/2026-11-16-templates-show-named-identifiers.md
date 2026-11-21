# Templates show named identifiers

> The plan and story templates show a named identifier for an item that other places refer to, and the skill text names the decisions it cites instead of "D14".

## Status

- **State:** Draft
- **Type:** docs
- **Review:** pr
- **Impl:** same branch
- **Rounds:** 3

## Changelog

- The plan template's Open Points and the story template's Open Points and Decisions show a named identifier with a short prefix for its kind, such as `[decision-person-approves-plans]` or `[question-…]`, for an item that another place refers to. The convention is a default, not a check: a repository with its own identifier style keeps it.
- The skills `plot-deliver`, `plot-approve` and `plot-idea` name the design decisions they cite instead of citing "D14", "D10", "D5" and "D3".

<!-- Board impact: none. No parser reads the content of an Open Points line or a Decision cell; `story-record.ts` checks only that `## Open Points` exists. -->

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
   - D10 → `[decision-person-approves-plans]` (`plot-approve/SKILL.md`)
   - D14 → `[decision-person-delivers-lone-tracer]` (`plot-deliver/SKILL.md`)

   The story's Decisions table gets the name after the code at each of the four definitions. The codes stay there, because the story's own files cite them.

### Open Points

- [ ] `[question-d10-name-scope]` Does `[decision-person-approves-plans]` fit D10, which holds for a Design plan only (`plot-approve/SKILL.md:124-128`)? The panel proposes `[decision-person-approves-design-plans]`. *(panel round 1: estate, contradiction, deliverable)*
- [ ] `[question-board-messages-keep-codes]` The refusal messages `approve.ts:332` and `entry/approve.ts:1060` print "(D10)", `approve.test.mjs:359` asserts it, and `auto-deliver.ts:325` cites D14. Are they in scope or named as out of scope? *(panel round 1: estate, contradiction, cost)*
- [ ] `[question-open-points-row-text]` `planOpenQuestions` shows the first unchecked Open Points line raw on a Draft plan row (`draft-plan-row.tsx:64-67`), so `Board impact: none` is false. Does the prefix move out of the first line, or does the row strip it? *(panel round 1: contradiction, cost)*
- [ ] `[question-citation-target-file]` `plot-idea/SKILL.md:281` cites D3 "in `DESIGN-phases.md`", which keeps the code. Does the citation name the story's Decisions table instead? *(panel round 1: contradiction, deliverable)*
- [ ] `[question-marker-and-name-order]` Does the identifier replace or follow the `⏸️`/`✅` markers on an Open Points bullet? *(panel round 1: contradiction)*
- [ ] `[question-changelog-and-cost-honesty]` The Changelog omits the `story-tracking/SKILL.md` wording and the archived Decisions-table edit; the changeset carries five skill bumps; a change under `skills/plot/templates/plan.md` selects every CI job (`ci-selection-jobs.test.mjs:128-133`). Does the plan state these? *(panel round 1: deliverable, cost)*
- [ ] `[question-other-cited-codes]` `plot-host.sh` comments cite D20, D23 and a D6 from another plan, and `gate.ts:438` uses "D14" for a different decision. Are they in scope? *(panel round 1: deliverable, estate)*
- [ ] `[question-design-doc-citations]` Should `DESIGN-phases.md` replace its citations "(D3)", "(D10)" and so on with names? This plan leaves them: the design doc sits beside the table that defines the codes, so its reader has the legend.
- [ ] `[question-name-uniqueness-and-rename]` Is a name unique per plan or story, and what happens to the places that refer to it when its wording changes? The plan states no rule, and the convention's only benefit over "D14" is that a reader resolves the reference without a legend. *(interview round 2: domain)*
- [ ] `[question-checklist-line-first-token]` `UNCHECKED` in `plan-open-questions.ts:9` captures the whole line after `- [ ] `, so the name is part of the board's first-question text and of the "n open" count source. Is a name followed by a sentence the intended shape, or does a bare name with no sentence count as an open point? *(interview round 2: technical)*
- [ ] `[question-challenge-skill-writes-points]` `challenge-the-plan/SKILL.md:514-525` tells the skill to append deferred items to Open Points and `:630` to write contradictions as checkbox entries. Does the skill adopt the prefix convention, or do the plans it writes keep unnamed lines beside the template's named ones? *(interview round 2: domain)*
- [ ] `[question-adopter-evidence]` The Motivation rests on one measured case, "D14" in `plot-deliver`. How many plans and stories under `docs/` already carry a legend-bound code, and does a count change the decision between a convention and no change? *(interview round 2: trade-offs)*
- [ ] `[question-d10-name-fits-definition]` The D10 definition (`STORY-plot-works-in-five-phases.md:86`) is mainly about the fleet commissioning a spec for a Design plan, and ends with "Approval stays a person's act". Both `[decision-person-approves-plans]` and `[decision-person-approves-design-plans]` name only that last sentence. Does the name follow the definition's subject? *(panel round 3: deliverable)*
- [ ] `[question-template-reading-tests]` Four tests read the plan templates: `parser.test.mjs:2593-2605`, `skills-say-slices.test.mjs:63,83`, `approve-record-outside-comments.test.mjs:46` and `started-record-outside-comments.test.mjs:3`. The Notes name only `story-record.ts`. Does the plan run them and record the result? *(panel round 3: estate)*
- [ ] `[question-existing-adopter-templates]` `plot-init/SKILL.md:605-606` copies the shipped plan template once into an adopter's `.plot/templates/plan.md`. An existing adopter's copy never receives the convention. Does the plan say so? *(panel round 3: contradiction, cost)*
- [ ] `[question-interrogate-reads-open-points]` `interrogate.ts:39` and `contract/schema.ts` also name Open Points. Do they join the readers that `[question-open-points-row-text]` checks? *(panel round 3: estate)*
- [ ] `[question-adopter-evidence-path-set]` The round-3 counts of files carrying a legend-bound D-code differ: 24 under `docs/stories` and `docs/plans`, 41 with `skills/` added. Which path set does `[question-adopter-evidence]` count? *(panel round 3: estate, cost)*

## Slices

### Templates and skill text

- `docs/templates-show-named-identifiers` — plan and story templates, story-tracking wording, four named decision citations, one changeset

## Notes

- No parser depends on the changed lines: `packages/domain/src/rules/story-record.ts` tests only for the heading `## Open Points`, and no script reads a Decision cell.

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

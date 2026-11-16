# Templates show named identifiers

> The plan and story templates show a named identifier for an item that other places refer to, and the skill text names the decisions it cites instead of "D14".

## Status

- **State:** Draft
- **Type:** docs
- **Review:** pr
- **Impl:** same branch

## Changelog

- The plan template's Open Points and the story template's Open Points and Decisions show a named identifier, such as `[a-person-approves-every-plan]`, for an item that another place refers to. The convention is a default, not a check: a repository with its own identifier style keeps it.
- The skills `plot-deliver`, `plot-approve` and `plot-idea` name the design decisions they cite instead of citing "D14", "D10", "D5" and "D3".

<!-- Board impact: none. No parser reads the content of an Open Points line or a Decision cell; `story-record.ts` checks only that `## Open Points` exists. -->

## Motivation

A reader of a skill, a plan or a story cannot resolve a code such as "D14" without the table that defines it, and that table is in another file. `plot-deliver/SKILL.md` cites "(decision D14)" and "(decisions D5 and D14)"; the definitions are in the Decisions table of the archived story `plot-works-in-five-phases`. An agent that writes a plan copies the habit, and the next reader needs the legend again.

A descriptive name in square brackets, as inline code, reads without a legend: `[a-person-delivers-a-lone-tracer]` instead of "D14". The templates are where an agent learns the shape of a plan and a story, so they are where the convention takes effect.

Adopters have different tastes, so Plot adds no gate, no config key and no lint finding. A repository that numbers its items keeps doing so.

## Design

### Approach

1. **Plan templates.** `skills/plot/templates/plan.md` (`### Open Points`) and `.plot/templates/plan.md` (`### Open Questions`) show the identifier on the placeholder line, with one comment line: a point that another place refers to gets a name, not a number.
2. **Story template.** `skills/story-tracking/STORY-template.md`: the `## Open Points` bullets start with an identifier placeholder, and the identifier starts the Decision cell. The table keeps its three columns, so existing stories stay valid.
3. **story-tracking skill.** Two sentences where `SKILL.md` describes updating the story file: give a decision or question that another place refers to a descriptive name in square brackets, as inline code; a repository with its own identifier style keeps it.
4. **Cited decisions.** The four codes in skill text get names from their definitions in `docs/stories/archived/plot-works-in-five-phases/`:
   - D3 → `[a-person-decides-design]` (`plot-idea/SKILL.md`)
   - D5 → `[a-tracer-plan-is-a-full-plan]` (`plot-deliver/SKILL.md`)
   - D10 → `[a-person-approves-every-plan]` (`plot-approve/SKILL.md`)
   - D14 → `[a-person-delivers-a-lone-tracer]` (`plot-deliver/SKILL.md`)

   The story's Decisions table gets the name after the code at each of the four definitions. The codes stay there, because the story's own files cite them.

### Open Points

- [ ] `[design-doc-citations-keep-codes]` `DESIGN-phases.md` cites the decisions as "(D3)", "(D10)" and so on in many places. This plan leaves them: the design doc sits beside the table that defines the codes, so its reader has the legend.

## Slices

### Templates and skill text

- `docs/templates-show-named-identifiers` — plan and story templates, story-tracking wording, four named decision citations, one changeset

## Notes

- No parser depends on the changed lines: `packages/domain/src/rules/story-record.ts` tests only for the heading `## Open Points`, and no script reads a Decision cell.

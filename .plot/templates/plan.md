<!-- Project-local plan template for the plot repo itself. Preferred over the
     shipped skills/plot/templates/plan.md by plot-plan-template.sh. This is a
     COMPLETE template (not merged with the shipped one) — keep the structural
     fields (Status, Changelog, Design, Branches, Notes) in sync with the
     shipped template when it changes; add plot-project-specific prompts here. -->

# <title>

> <one-line summary>

## Status

- **Phase:** Draft
- **Type:** feature | bug | docs | infra
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->

## Changelog

<!-- Release note entry. Written during planning, refined during implementation.
     Skills are changeset-driven: if this change touches a skill, add a
     `.changeset/*.md` with a `bumps: skills:` block rather than editing SKILL.md
     version fields by hand. -->

- <user-facing change description>

<!-- Board impact: does this touch the plan format, the plan template, the helper
     scripts (skills/plot/scripts/), or the docs/plans layout? "none" is a valid
     answer. Considering board impact is part of the Definition of Done —
     see docs/definition-of-done.md. The board lives at packages/board
     (@plot-pm/board); rebuild its artifact (pnpm build:board) if the plan
     contract it consumes changes. -->

## Motivation

<!-- Why does this matter? What problem does it solve? -->

## Design

### Approach

<!-- How will this be implemented? Key architectural decisions.
     Monorepo layout: skills live at the repo root; the board is a package under
     packages/. A change to the plan format or helper scripts often has board
     implications — call them out here. Design decisions must pass the
     MANIFESTO.md 8-question checklist. -->

### Open Questions

- [ ] ...

## Branches

<!-- Optional: define a tracer bullet (thin vertical slice) first. -->
<!-- See the tracer-bullets skill for guidance. -->
<!-- ### Tracer -->
<!-- - `feature/<slug>-tracer` — <thin slice description> -->
<!--   Layers: <layer> → <layer> → <layer> -->
<!--   Proves: <what this validates> -->
<!--   Status: Not started -->

<!-- When using ### Tracer, wrap remaining branches in ### Implementation: -->
<!-- ### Implementation -->

- `feature/<slug>` — <description>

## Notes

<!-- Session log, decisions, links. Definition of Done: docs/definition-of-done.md -->

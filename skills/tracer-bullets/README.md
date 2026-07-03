# tracer-bullets

## Purpose

General development strategy for reducing uncertainty through thin vertical slices. Guides building one end-to-end path through all system layers before widening into full implementation. Works standalone on any branch or project. Plot skills reference it as a sibling — see `plot/SKILL.md` Sibling Skills section for integration details.

## Tier

Reusable / Publishable — project-agnostic.

## Provenance

- **Concept:** "Tracer Bullets" from *The Pragmatic Programmer* (Hunt & Thomas, 1999)
- **AI application:** ["Tracer Bullets"](https://www.aihero.dev/tracer-bullets) by AI Hero — explores why tracer bullets are especially important in AI-assisted development, where agents build horizontal layers without feedback loops
- **Skill design:** Brainstorming session 2026-03-07, exploring how the concept fits into the Plot workflow family

## Testing

### Scenario 1: Standalone (no plot context)

1. On any feature branch, invoke `/tracer-bullets`
2. Verify it guides through: identify slice → define tracer → build → evaluate
3. Verify it does NOT require a plan file or plot conventions

### Scenario 2: Plot pre-approval

1. `/plot-idea tracer-test: Test tracer bullet workflow`
2. Add `### Tracer` subsection to plan's `## Branches`
3. Use `tracer-bullets` skill on the idea branch
4. Verify tracer code lives alongside plan files
5. Verify plan gets `## Tracer Results` section
6. `/plot-approve` — verify tracer code carries forward

### Scenario 3: Plot post-approval

1. Create and approve a plan with `### Tracer` subsection
2. Use `tracer-bullets` skill — verify it creates `feature/<slug>-tracer` branch
3. Merge tracer PR, then continue with remaining impl branches

### Status

Not yet tested with subagent pressure scenarios per the writing-skills TDD methodology. First version based on brainstorming design.

## Known Gaps

- No automated verification that the tracer exercises all listed layers
- Heuristic evaluation in `/plot-approve` relies on mid-tier model judgment

## Planned Improvements

- Tracer status display in `/plot` dispatcher output
- Subagent test scenarios per writing-skills methodology

# The plan format drops what nothing uses

> Withdrawn 2026-09-05, unstarted. Its central claim was wrong and its two remaining findings dissolved on inspection.

## Status

- **State:** Rejected
- **Type:** infra
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** none
- **Rounds:** 1
- **Rejected:** 2026-09-05, Jan Wloka, in-session

## Changelog

- Nothing. The plan is withdrawn before any slice was started.

## Why it was withdrawn

**The central claim was wrong.** The plan argued that `Design:` is a declared field nothing writes, and proposed removing it. It is not a field: `design` is a **state** in `transitions/plan.ts:19`, handled at `:210` and `:311`, refused by `/plot-implement` (*"Draft or Design → stop"*), and `plot-plan-meta.sh:84` says so plainly — *"design is a phase of its own, not a synonym for anything."*

Measured 2026-09-05: **0 of 207 plans have ever been in it**, which is a real observation. But *an unused state in a lifecycle* is a different subject from *a dead field in a format*, and the plan argued the second while measuring the first.

**The second finding corrected itself between the spec and the plan.** `DESIGN-plan.md` asked whether `Type: docs` was dead, citing *"zero of 158 plans"*. Measured today: **1 of 204** — `2026-08-30-a-machine-is-an-instance.md` uses it. The open point had already answered itself; nothing needed doing.

**The third belongs to a plan that already owns it.** CLAUDE.md describing four phases when the domain has more is a symptom of the conflation [`the-workflow-owns-the-word-phase`](2026-09-04-the-workflow-owns-the-word-phase.md) exists to fix. That plan is Approved and in flight, its first slice merged as #711, and the correction is being folded into it rather than duplicated here.

## What the round established instead

**Stories and plans have STATES. Only the workflow has PHASES.** Both states map onto the workflow's phases; neither carries one.

That is a sharper statement of what `the-workflow-owns-the-word-phase` set out to separate, and it moves there. `rules/phase.ts:43` mapping a plan's state to a board column is the conflation seen from the rendering side.

## Notes

### Why a rejected plan is kept — 2026-09-05

The estate holds rejected plans rather than deleting them, and this one is worth reading: it is a plan that measured correctly and reasoned wrongly about what it measured. `0 of 207` was true; *dead field* was not.

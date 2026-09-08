PLOT-BLOCKED: `infra/a-lifecycle-field-has-one-writer` waits on `feature/a-sprint-transition-is-performed`, which has not been started — no branch on origin, no PR, no worktree. Should this slice wait, or should the same worker implement the sprint-transition slice first?

## What was checked

| question | answer |
|---|---|
| `feature/a-sprint-transition-is-performed` on origin? | no — `git ls-remote --heads origin` returns nothing |
| a PR for it, any state? | none — `gh pr list --state all` is empty |
| landed under another name? | no — `setSprintState` still has zero production callers on `main` |
| a worktree or local ref? | none |
| does it have a brief? | yes — `.plot/briefs/a-sprint-transition-is-performed.md` |

`CLAUDE.md:458` on `main` still reads *"`setSprintState` — nine refusals, zero callers"*, which is the plan's own evidence that the dependency is outstanding.

## Why this blocks rather than proceeds

The brief states the wait twice — *"do not start before it lands"* and *"a gate refusing the only available method stops work rather than routing it"* — and the plan gives the reason a third time: *"the controller has to exist before the shortcut is closed."*

This slice's entire content is a gate refusing hand edits to `State:` lines in `docs/plans/` and `docs/sprints/`. The dependency is what gives a sprint transition a route to take instead.

**Measured on `origin/main` — `/plot-sprint` documents the hand edit as the only method:**

| SKILL.md line | instruction |
|---|---|
| 397, 414 | `# **State:** Planning → **State:** Committed` |
| 450 | ``Change `**State:** Committed` → `**State:** Active` `` |
| 662 | ``Change `**State:** Active` → `**State:** Closed` `` |

Shipping the gate now refuses `/plot-sprint` at all three of its transitions, with nothing to route to. That is the exact failure the wait exists to prevent, so proceeding would deliver a slice that breaks the sprint lifecycle rather than one that protects it.

## The two ways forward, and why this needs a person

1. **Hold this branch** until `feature/a-sprint-transition-is-performed` is dispatched and merged, then restart this worker. Nothing here is lost — this branch carries no work yet.
2. **Widen this worker's scope** to implement the sprint-transition slice first, then this one. That is a different slice with its own branch, its own brief and its own PR in the plan, so it is not mine to take on unasked.

Option 2 changes the plan's branch structure, which is why this stops here rather than choosing. **No files were modified on this branch.**

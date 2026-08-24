## Implementation brief — the-agents-tab-filters-to-the-sprint (wave: Counted)

- **Plan (canonical):** `docs/plans/2026-08-23-the-agents-tab-filters-to-the-sprint.md` on main
- **Branch:** `feature/the-fleet-knows-its-sprints` (base: `main`)
- **Ends as:** one PR to `main`
- **Waits on:** nothing — `Parsed` (#365) and `Carried` (#373) are merged.
- **Blocks:** `Reported`, `Filtered` and `Repointed`, all three of this plan's
  remaining waves. This is the wave the rest of the plan is queued behind.

### What to build

The fleet payload carries each Active sprint with its **target release** and its
**four `status` counts**, aggregated server-side from `plan.status`.

### The decision this plan already settled — do not re-derive it

**It reads `plan.status`; it does not compute it.** Four consumers already answer
*is this plan done?* their own way, and that is the defect the status field was
added to fix — a fifth would make it worse. `planStatus(meta, pulse)` is the
whole subject of `a-plan-has-a-phase-and-a-status`, and this branch is its FIRST
CONSUMER, not a second producer of the same answer.

## Resolved 2026-08-24: the dependency has landed

A previous worker on this branch stopped and wrote `PLOT-BLOCKED.md`, correctly:
`planStatus` was not on `origin/main`, and this plan forbids computing the counts
locally ("It reads `plan.status`, it does not compute it"). Stopping was right.

**PR #374 has since merged.** `planStatus` is on `origin/main` — verify with:

    git show origin/main:packages/board/src/server/board.ts | grep -c planStatus

So proceed as the plan intended: you are `plan.status`'s FIRST CONSUMER.

- Do NOT copy `planStatus` locally — that is the "fifth definition of done" this
  plan exists to prevent.
- Do NOT rebase onto the #374 branch — it is merged; `origin/main` has it.
- Merge `origin/main` first, then aggregate the four counts (`delivered`,
  `deliverable`, `in-progress`, `approved`) server-side from `plan.status`.

**Also in scope, and the earlier worker was right to flag it:** `SprintCard` has
no `release` field, and the plan wants each Active sprint's target release in the
payload. Add it — the value is the sprint file's `Release:`. Shipping the counts
without it would be half the payload the plan asks for.

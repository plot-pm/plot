# Brief — bug/one-component-renders-every-row

The **Collapsed** wave of `docs/plans/2026-08-20-a-row-is-a-tuple.md`, and the
last one. Its two predecessors are merged: `feature/a-row-is-a-tuple` (#293) added
the tuple row and the `kind` field, `feature/the-wave-and-the-phase-find-their-owners`
(#299) moved the wave and the plan phase to the objects they describe.

Read the plan before starting. It was interrogated on 2026-08-20 and five
decisions are recorded there; this brief does not restate them, it names what
this branch does with them.

## What to do

Replace `Row`, `PlanRow` and `IssueRowView` with the tuple row, and collapse
`ROW_TRACKS` and `PLAN_ROW_TRACKS` into one grid.

Also absorbs what `feature/the-row-leads-with-its-subject` would have done: with
slot 3 holding the item name, *which fact leads* is answered by construction, so
what remains is **deleting** the per-kind leading logic rather than writing a
rule for it.

## The measurement that decided the shape

From `AgentList.tsx`, measured 2026-08-20:

| component | grid | size |
|---|---|---|
| `Row` (branch, and PR as a cell) | `ROW_TRACKS` | **555 lines** |
| `PlanRow` | `PLAN_ROW_TRACKS` | **149 lines** |
| `IssueRowView` (ticket) | **`ROW_TRACKS`** | 2 lines — a wrapper |

Two grids for **three** components, and the third renders a ticket through the
tracks of a *branch*. A ticket has no wave, no worker and no branch; it wears
those columns because there was no third grid to give it. That is the same defect
as the four-meanings phase column, at a second site.

**One component, not a shared grid with three fillers.** Three fill sites is
exactly how the two grids drifted apart, and keeping them while adding a contract
keeps the drift possible.

## Why this is the last wave, and what that means for you

It rewrites ~700 lines in a file of 5,664 that took **11 commits on 2026-08-20
alone** and conflicted on nearly every merge that day. It was ordered last so it
would land when no sibling branch is open against it.

**That condition holds right now and is fragile.** Two other branches are
eligible and both touch what you are deleting — `bug/a-plan-row-is-not-a-branch-row`
works on `ROW_TRACKS`, and `bug/the-marker-gets-a-track-of-its-own` on
`AgentList` *and* `ROW_TRACKS`. Neither is dispatched, deliberately. So:

- **Push your first real commit as soon as it exists.** An unpushed 700-line
  rewrite of this file is the most expensive thing in this repo to lose.
- **Rebase and push again immediately** after any rebase.

## Scope

- `AgentList.tsx`: delete `Row`, `PlanRow`, `IssueRowView`, `ROW_TRACKS`,
  `PLAN_ROW_TRACKS`; route every kind through the tuple row.
- Whatever in `Swimlanes.tsx` or the section renderers referenced the deleted
  components.
- Nothing in the contract. `kind` and the slots landed in #293; if you find you
  need a new field, that is a discovery to report, not to implement.

## Out of scope

- **Membership.** Which section a row appears in is unchanged. The plan says so
  and the tests below pin it.
- **The `⋯` menu.** `the-menu-fits-the-kind` (#280) owns per-kind actions. The
  tuple says what a row IS; the menu says what can be done to it.
- **New host calls.** Every slot derives from what the pulse already carries.

## Tests the plan requires

- one grid renders a plan row, a branch row and a ticket row
- no row prints a phase belonging to another object
- **a PR row's dominant slot holds the PR, and its branch is an artifact link**
- **a merge conflict is still readable on the branch it belongs to** — 67 of 80
  live rows carry both a branch and a PR, so this is the normal case, not an edge
- a ticket no longer wears the branch tracks
- the sections keep their membership
- **every assertion the three deleted components carried still has an owner** —
  this is the one that takes the longest and the one that makes the deletion safe

## Judgement calls that are yours

The plan settled *what* the slots are and *that* one component renders them. How
the component is structured internally — one switch, a per-kind slot builder, a
map — is not specified and does not need to be. Pick what makes the deletion
reviewable.

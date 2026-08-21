# A plan with one wave has no wave — it is the wave

> Nobody should have to learn what a wave is to implement a plan. Where a plan
> holds exactly one, the plan IS the unit of work: the board shows no wave row
> for it, and every wave action is on the plan row.

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** plot-planning-model
- **Review:** pr
- **Impl:** own branches

## Changelog

- A plan with a single wave shows as itself on the board, and carries the
  actions its wave would have carried — `/plot-implement` and `/plot-dispatch`
  work on it without the reader learning the wave concept.

<!-- Board impact: this is board rendering plus two spoke commands. `rowKind`,
     the wave grouping and the plan row's action set all move; the plan format
     and `plot-plan-meta.sh` do not — a one-wave plan already parses as one
     wave, which is exactly what makes this possible without a format change. -->

## Motivation

A wave answers *in which order* — it is the mechanism that lets some branches
run while others wait. A plan with one wave has nothing to order. The concept is
still there, still named on the row, and still something a newcomer has to
absorb before they can act.

**The operator's framing:** *"Plans with a single WAVE don't have a WAVE. The
plan is the WAVE. We're implementing the plan not a plan's wave."*

So the wave row for a one-wave plan is repetition wearing a second name: one
plan, one wave, one branch, two rows saying it.

### Measured, and it does not fix anything today

Counted 2026-08-21 across this repo's active plans:

    plans with exactly one wave   0
    plans with several waves     25

Not one plan in this estate is affected. That is not an objection — it is the
finding. This repo belongs to people who learned the wave concept, so the plans
here are cut the way waves are for. The change is for the plans that do not
exist here: a newcomer's first, written before they know what a `### ` heading
buys them.

It is therefore an **onboarding change, not a repair**, and this plan claims
nothing else. A version that argued from broken rows would be arguing from rows
nobody has.

### Where it does NOT apply

*"This does not count for plans with some waves merged and other still open."*

A plan whose waves have partly landed is not a one-wave plan and must not become
one. The count that matters is **waves the plan declares**, not waves still
open — otherwise a three-wave plan would silently turn into a "one-wave plan"
the moment its second-to-last wave merged, and the ordering the reader was
shown would vanish at the point it was still being relied on.

The test is therefore `plan.waves.length === 1`, evaluated on the plan file, and
never on remaining or unmerged work.

## Design

### The two commands differ, and the difference is the point

Both must work on a one-wave plan, and they are not the same act:

| | Where the work happens |
|---|---|
| `/plot-implement <slug>` | **In this session.** The main agent does it. |
| `/plot-dispatch <slug>` | **Off it.** A worktree, a brief, a detached agent. |

*"plot-dispatch on a plan with a single wave dispatches the plan implementation
to an available agent (off the main agent with a brief) while plot-implement
implements the plan within the master agent's session."*

Neither today takes a plan as the unit for that: dispatch fans out **eligible
branches** and implement prepares a branch per the plan's ceremony. For a
one-wave plan both should read the plan itself as the thing, which is a change
to what they take as input, not to what they do.

### What the board shows

A one-wave plan renders as one row — the plan row — carrying:

- the plan's phase, age and link, as it does now;
- the wave's **status**, since the wave has no row to carry it;
- the wave's **actions**, which is what makes `/plot-implement` reachable
  without the word *wave* appearing anywhere.

The branch beneath it still renders. What disappears is the row in between.

**And the actions are ADDITIONAL, not moved.** *"All wave actions are
additionally available on the plan row."* A multi-wave plan keeps its wave rows
and their actions; the plan row gains them where there is exactly one wave to
act on. A plan row that offered *Start work* while three waves waited would have
to pick one, and picking is what the wave rows are for.

### Open Questions

- [ ] Where a one-wave plan's row shows a status, whose is it — the plan's phase
      or the wave's verdict? They disagree: a plan can be `Approved` while its
      wave is `blocked`.
- [ ] Does the unnamed-wave case merge with this one? A plan with no `### `
      heading has one unnamed wave, so by this rule it renders as a plan row —
      which is what `2026-08-21-a-wave-is-one-branch.md` wants for a different
      reason. Two plans should not both change that row.
- [ ] `/plot-dispatch` claims by ref push on a branch. With the plan as the
      unit, what does it claim — still the branch, or does the plan gain a
      claim of its own? The branch, most likely; the question is whether the
      command's output should still say *wave*.

## Branches

### Shown

- `feature/one-wave-renders-as-its-plan` — a plan declaring exactly one wave
  renders no wave row; the plan row carries the wave's status. Tests: a
  one-wave plan yields a plan row and no wave row; a two-wave plan is
  unchanged; a plan whose second wave has merged still renders both, because
  the count is of DECLARED waves; the branch rows beneath are unaffected; the
  derivation is the server's and is not remade in the renderer.

### Offered

- `feature/the-plan-row-carries-wave-actions` — every action a wave row offers
  is also on the plan row where the plan has one wave. Tests: the actions
  appear on a one-wave plan's row; they are absent on a multi-wave plan's row;
  each spawns the same command the wave row would have spawned; a refusal names
  itself on the control, as elsewhere; the wave row's own actions are unchanged
  where a wave row exists.

### Taken

- `feature/implement-and-dispatch-take-a-plan` — `/plot-implement` and
  `/plot-dispatch` accept a one-wave plan as the unit of work, keeping their
  distinction: implement works in this session, dispatch hands a brief to a
  detached agent in its own worktree. Tests: both accept a one-wave plan's slug;
  both refuse a multi-wave plan with a message naming its waves; dispatch still
  claims by ref push on the branch; implement still records `Started:`; neither
  command's behaviour on a multi-wave plan changes.

## Notes

Raised while the board was being read row by row, alongside
`2026-08-21-a-wave-is-one-branch.md` and `2026-08-21-done-means-delivered.md`.
The three touch the same rows and should be sequenced rather than run in
parallel — the second Open Question above is where they overlap.

The estate count (0 of 25) is recorded because it will be asked: this cannot be
verified against existing plans, only against new ones, and the first honest
test of it is somebody writing their first plan without being told what a wave
is.

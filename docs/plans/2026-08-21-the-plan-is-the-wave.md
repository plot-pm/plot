# A plan with one wave has no wave — it is the wave

> Nobody should have to learn what a wave is to implement a plan. Where a plan
> holds exactly one, the plan IS the unit of work: the board shows no wave row
> for it, and every wave action is on the plan row.

## Status

- **Phase:** Approved
- **Type:** feature
- **Story:** plot-planning-model
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-08-22, Jan Wloka, plan-PR #305 merged

## Changelog

- A plan with a single wave shows as itself on the board: no wave row repeating
  what the plan row already says. 38 of this repo's 84 plans are one-wave, 23 of
  them declaring no wave name at all.

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

### Measured — and it fixes 38 rows that exist today

Counted 2026-08-22 across every plan in `docs/plans/`, by
`plot-plan-meta.sh`, which is the same parser the board derives from:

    plans with exactly one wave    38  (of 84)
      of those, wave is NAMED      15
      of those, wave is UNNAMED    23
    plans with several waves       46

Among the twelve currently OPEN plans, three are one-wave.

**An earlier draft of this plan recorded `0 of 25` and built its whole framing
on that number** — an onboarding change for plans nobody had written yet,
explicitly "not a repair", and unverifiable against this estate. The number was
wrong. Whatever it counted, it excluded one-wave plans systematically: neither
the full estate (84) nor `docs/plans/active/` (2 today) produces 25, and no
reading of either produces 0.

The correction inverts the argument rather than adjusting it. **Nearly half the
estate renders a wave row that says what its plan row already says**, so this is
a repair, verifiable today, against rows a reader can point at. The onboarding
benefit remains and is now the second reason rather than the only one.

### Where it does NOT apply

*"This does not count for plans with some waves merged and other still open."*

A plan whose waves have partly landed is not a one-wave plan and must not become
one. The count that matters is **waves the plan declares**, not waves still
open — otherwise a three-wave plan would silently turn into a "one-wave plan"
the moment its second-to-last wave merged, and the ordering the reader was
shown would vanish at the point it was still being relied on.

The test is therefore `plan.waves.length === 1`, evaluated on the plan file, and
never on remaining or unmerged work.

**Named or unnamed makes no difference, and the rule says so once.** 23 of the
38 one-wave plans declare no `### ` heading at all, so their single wave has no
name — the parser reports one unnamed wave, which is what the format has always
meant. Whether that wave carries a word is a labelling question; **the count is
the rule**. A named single wave (`Shown`, `Tracer`) loses its label to the plan
row, and that is the intended trade: one row saying one thing beats two rows
where the second adds a word.

This resolves the second Open Question below, and the overlap it names: a plan
with no heading renders as its plan row *here*, so `a-wave-is-one-branch` does
not need to make that row change for its own reason. It keeps the repair it is
actually about — slicing an unsliced plan — and inherits this rendering.

## Design

### What this plan does NOT own

**The plan row's ACTIONS belong to `an-approved-plan-offers-its-two-starts`**
(PR #313), which puts Implement and Dispatch on the plan row of any approved,
unstarted plan — one wave or several. This plan owns the RENDERING question:
whether a one-wave plan shows a wave row at all. The two meet on the same row
and answer different questions, so they are sequenced rather than merged, and
this plan's third branch is dropped as work #313 already covers.

**A correction that travels with that boundary.** An earlier draft described
`/plot-implement` as the command where *"the main agent does it"*, in this
session. It is not: the skill prepares and explicitly never implements — a
staleness preflight, the branch per the plan's recorded ceremony, a hand-off
brief, and a `Started:` record — then hands that brief to whatever writes the
code. The distinction from `/plot-dispatch` is real but it is not
*here versus elsewhere*; it is **prepare one branch for a person** versus
**start a detached worker per eligible branch**.

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
      wave is `blocked`. This is the one question the interrogation did not
      settle, and it is a rendering decision wave 1 must make.
- [x] Does the unnamed-wave case merge with this one? **Yes** — the rule is the
      wave COUNT, not whether the wave carries a name, and 23 of the 38 one-wave
      plans are unnamed. Stated in the Motivation; `a-wave-is-one-branch` keeps
      the repair it is about and inherits this rendering.
- [x] What does `/plot-dispatch` claim, with the plan as the unit? **Moot** —
      the command work moved to PR #313, and dispatch keeps claiming the branch
      by ref push. Nothing about claiming changes here.

## Branches

### Shown

- `feature/one-wave-renders-as-its-plan` — a plan declaring exactly one wave
  renders no wave row; the plan row carries the wave's status. Tests: a
  one-wave plan yields a plan row and no wave row; a two-wave plan is
  unchanged; a plan whose second wave has merged still renders both, because
  the count is of DECLARED waves; the branch rows beneath are unaffected; the
  derivation is the server's and is not remade in the renderer.

### Offered

- `feature/the-plan-row-carries-wave-actions` — where wave 1 removes a wave
  row, the actions that row carried move onto the plan row with it. Concretely
  that is **Start work**: a wave row's own control, dispatching that wave with
  `--max 1`. It is NOT Approve, Implement or Dispatch — those are plan-level
  acts that `an-approved-plan-offers-its-two-starts` (PR #313) gates on
  approved-and-unstarted, and they reach the plan row whatever its wave count.
  This branch only ensures that hiding a row does not hide its control. Tests:
  a one-wave plan's row offers Start work; a multi-wave plan's row does not,
  because its wave rows still carry their own; the button dispatches the same
  single wave the hidden row would have; a refusal names itself on the control;
  the wave row's actions are unchanged wherever a wave row still renders; the
  plan-level acts from #313 are unaffected by the wave count.

<!-- `feature/implement-and-dispatch-take-a-plan` was removed 2026-08-22.
     Putting Implement and Dispatch on the plan row is
     `an-approved-plan-offers-its-two-starts` (PR #313), which gates them on
     approved-and-unstarted rather than on the wave count. Two branches
     changing one row's action set would collide on the same predicate. -->

## Notes

Raised while the board was being read row by row, alongside
`2026-08-21-a-wave-is-one-branch.md` and `2026-08-21-done-means-delivered.md`.
The three touch the same rows and should be sequenced rather than run in
parallel.

**Interrogated 2026-08-22, and the interrogation overturned the plan's premise.**
It recorded `0 of 25` one-wave plans and argued from that: an onboarding change
for plans nobody had written, "not a repair", unverifiable against this estate.
Re-counted with `plot-plan-meta.sh`: **38 of 84**, 23 of them with no wave name,
and 3 of the 12 open plans. The change repairs rows that exist, which is a
different plan from the one that was written — and a reminder that a measured
number in a plan is worth re-measuring before it is built on, especially the one
the argument rests on.

Two of the three Open Questions closed with it: the unnamed case is the same
case (the count is the rule), and the claiming question went with the command
branch to PR #313. The status question survives and belongs to wave 1.

Scope narrowed to rendering. Putting Implement and Dispatch on a plan row is
#313's subject, gated on approved-and-unstarted rather than on wave count; two
branches changing one row's action set would collide on the same predicate.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": false, "implementation": false},
    "domain": {"rules": false, "workflows": false, "data": false},
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": false
  },
  "_note": "Back-filled 2026-08-22: this plan was interrogated once on 2026-08-22 (see ## Notes). The round count is recorded, but the questionHistory could not be reconstructed from prose after the fact, so it is left empty rather than invented."
}
END-CHALLENGE-THE-PLAN-METADATA -->

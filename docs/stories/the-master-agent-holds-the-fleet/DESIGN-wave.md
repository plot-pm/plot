# DESIGN — Wave

> What the fleet lands together. Nineteen entity specs describe what Plot knows and what it runs; the Wave is the one entity the story is named for and the only one nothing constructs.

## Contents

0. [What a Wave is for](#0-what-a-wave-is-for)
1. [The gap, measured](#1-the-gap-measured)
2. [Wave and Slice](#2-wave-and-slice)
3. [The two halves that exist](#3-the-two-halves-that-exist)
4. [Which bound wins](#4-which-bound-wins)
5. [Formation](#5-formation)
6. [A Wave is not persisted](#6-a-wave-is-not-persisted)
7. [What this does not settle](#7-what-this-does-not-settle)

## 0. What a Wave is for

**A Wave is the set of slices the fleet works at once, chosen so that what
finishes can land.** It exists to answer one question no component asks today:
*given every plan on the estate, which slices should be in flight together?*

**The answer is not "as many as fit".** Slices that collide in the same files
finish into a merge queue that serialises them anyway, and the second one
rebases through a conflict its author never saw coming. Choosing the cohort is
what turns N agents into N landings rather than N branches.

## 1. The gap, measured

**Nothing forms a Wave.** `DESIGN-slice.md:705` states it plainly — *"Who forms
a Wave? Nothing does today"* — and the code agrees. Measured 2026-09-05:

```
entities/wave.ts    declares Wave, WaveBound, SliceRef, plansSpanned
                    constructed by: nothing
plot-dispatch.sh    requires a plan slug
plot-merge-queue.sh "plot-merge-queue: need a plan slug"
```

**Both halves refuse the cross-plan question by construction.** The fleet scan
computes eligibility across every plan; the merge queue computes collisions
within one. Neither has ever been asked the question the other answers.

**The estate is already past the point where it matters.** The same day:

```
13 plans   47 slices   4 eligible   parallelAgents: 5
```

Four eligible slices spread across thirteen plans, and a ceiling of five. Any
cohort formed here spans plans by necessity — a per-plan dispatch can offer at
most what one plan holds, which on this estate is one.

## 2. Wave and Slice

`DESIGN-slice.md` settles the vocabulary and this document does not reopen it:

| | Slice | Wave |
|---|---|---|
| holds | exactly one branch | many slices |
| scope | one plan | the fleet — slices from several plans |
| sized by | the work | the agents available, bounded by what can land |
| written | in the plan, as a section | nowhere — formed at dispatch |

**They are not nested versions of one idea.** A slice is authored by a person
and lives in a plan file; a wave is assembled by the fleet and belongs to no
plan.

**The code still says `Wave` where it means `Slice` in places**, which
`CLAUDE.md` records as a known defect with its own plan. Nothing in this
document may add to it: `Wave` here always means the cross-plan cohort.

## 3. The two halves that exist

**A Wave is those two joined.** Neither needs new capability; what is missing is
the join.

| half | answers | scope today |
|---|---|---|
| `plot-fleet-scan.sh` | which slices are **eligible** | every plan |
| `plot-merge-queue.sh` | which branches **collide** | one plan |

**The merge queue is the half that must widen.** It already predicts collisions
with `git merge-tree` and flags a branch that conflicts with one ahead of it in
the queue; it simply never sees two plans at once. Eligibility is already
estate-wide.

**And dispatch already reports collisions it does not act on.** Before fanning
out it names which other branches hold which files, *"read from local refs and
worktrees, so unpushed and uncommitted work counts"* — a report that refuses
nothing because nothing on the candidate side is predicted. **That report is
the Wave's input**, produced today and discarded.

## 4. Which bound wins

**`WaveBound` declares two and its own comment says the question is open:**

```ts
export const WaveBoundSchema = z.enum(['agents', 'landable']);
```

**`agents` is a ceiling and `landable` is a filter, and they are not
alternatives.** The agent count says how many slices *can be worked*; merge
compatibility says which of them *should be worked together*. A wave bounded by
agents alone is today's dispatch with a wider net; one bounded by landability
alone could exceed the machine.

**So both apply, in one order: filter, then cap.** Take the eligible set, drop
what collides with something already chosen, then take the first `parallelAgents`
of what remains. The enum records which bound *decided the size* — the answer a
report needs when a wave came out smaller than the ceiling.

**That ordering is a claim this document makes and the plan must test**: a wave
that filled to the cap without filtering would report `agents`, and one that ran
out of non-colliding work reports `landable`. The two are distinguishable in the
output, which is what makes the choice falsifiable.

## 5. Formation

**A Wave is formed at dispatch and by nothing else.** Not by the board, which
renders; not by the supervisor, which supervises what exists.

**It is a pure function of readings**, in the shape this domain already uses:
eligible slices in, collision predictions in, a cohort out. No port, nothing
awaited, no I/O — `reap(readings, input)` is the precedent.

**The caller reads.** Which is what keeps formation testable without a network:
the estate's real answers can be recorded once and replayed.

## 6. A Wave is not persisted

**`DESIGN-slice.md` settles this and it has consequences worth stating.** A wave
is *"assembled by the fleet at the moment of dispatch"* and has no persisted
form.

**So a wave cannot be resumed, only re-derived.** A dispatch interrupted halfway
leaves claimed branches and no record of the cohort they belonged to — and that
is correct: the next run re-reads eligibility and collisions and forms whatever
the estate now supports. The claims are the durable half; the grouping is not.

**And a wave has no identity.** Nothing names one, nothing counts them, no plan
references one. A report may describe the wave it just formed; nothing may look
one up later.

**This is the same property the pulse has**, and for the same reason: a
derivation that disagreed with git would be worse than no record at all.

## 7. What this does not settle

**Whether a wave may include a slice whose plan is not approved.** Eligibility
is per-slice and phase is per-plan; the two have never disagreed in a cohort
because no cohort has existed.

**What happens when a wave's slices finish out of order.** The merge queue
orders finished branches within a plan; a cross-plan wave finishing piecemeal
has no stated landing order, and whether one is needed depends on how often
collisions actually materialise — which nothing has measured, because nothing
has formed a wave.

**Whether the collision prediction is worth its cost at scale.** `git
merge-tree` per candidate pair is quadratic in the cohort, and the cohort is
bounded by `parallelAgents`, currently 5. At that size the cost is negligible
and the question is theoretical. It stops being theoretical somewhere, and
nothing knows where.

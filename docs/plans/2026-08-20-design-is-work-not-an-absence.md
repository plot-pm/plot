# Design is work, not an absence

> The board's `Design` column means *nobody has started* — it is
> `approved && !started`, computed from a branch's commit count. But design is
> an activity: a spike, a tracer bullet, a spec that makes a plan handable to
> development. A column named for work that is defined by the absence of work
> tells a reader the opposite of what it says.

## Status

- **Phase:** Draft
- **Type:** bug
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka

## Problem

Reported 2026-08-20 while asking why two branches of one plan can sit in
different phases. The answer exposed something larger than the question.

### Four phases, five columns

`CLAUDE.md` states the model plainly:

> Four workflow phases: **Draft → Approved → Delivered → Released**

The board draws **five** columns: Discovery, Design, Development, Endgame,
Released. The extra one is manufactured in `toBoardPhase`
(`packages/board/src/contract/schema.ts:432`):

```
draft     → Discovery                          always
approved  → started ? Development : Design     the only fork
delivered → Endgame                            always
released  → Released                           always
```

So `Design` is not a phase Plot has. It is `approved` with `started === false`,
and `started` means *this branch has commits or is merged*.

### What the column actually holds

Measured on the live board 2026-08-20:

| Column | Plans | What they are |
|---|---|---|
| Discovery | 1 | `the-row-says-what-it-knows` — genuinely still being written |
| **Design** | **3** | `a-wave-says-what-it-waits-for`, `opus5-longhorizon-hardening`, `the-index-is-derived` |
| Development | 1 | `working-shows-the-agent` |

**All three "Design" plans are fully specified, interrogated and approved.**
Their branches carry briefs. Not one of them is being designed — every one is
waiting for an agent. The column holds *approved work nobody has picked up*,
which is a queue, not a design stage.

### Why the naming is a defect and not a quibble

Design is a real activity this repo already does and already has tooling for:
`skills/tracer-bullets/` exists precisely for *"a thin vertical slice"* when the
architecture is unproven. A spike, a tracer bullet, a spec that answers what a
plan could not answer at approval time — that is work someone performs, produces
commits for, and finishes.

Under the current mapping such a plan is **indistinguishable from one nobody has
touched**, and worse: the moment someone starts the spike, its branch gains
commits and the plan moves to `Development` — leaving `Design` again populated
only by untouched work. The column can never contain design in progress. It is
structurally reserved for its own absence.

This is the same defect the board has been removing all week — a row stating a
fact whose consequence it withholds — one level up: a **column** whose name
states an activity while its membership states an absence.

### The mapping has been wrong here before

`schema.ts:438` carries the scar: a comment recording that an earlier version
"left Discovery a column nothing could ever reach". The five-column shape has
already been repaired once by adjusting which phase maps where, rather than by
asking whether five columns match four phases.

## Design

### Three ways out, and the choice is the operator's

**A. Rename the column to what it holds.** `Design` becomes `Ready` (or
`Queued`): approved, specified, nobody started. One string, no model change, and
the board stops claiming an activity it cannot show. Design work then appears
under `Development` alongside implementation, which is honest — it *is* someone
working — but loses the distinction between proving an approach and building it.

**B. Give design its own phase in the model.** A fifth phase between Approved
and Delivered, entered deliberately (`/plot-spike`?) and left when the question
is answered. Plot gains a real place for tracer bullets, and the board's fifth
column earns its name. The cost is a phase that every spoke command must
validate, and the phase guardrails are four rules today.

**C. Drop the column.** Four phases, four columns. `approved` is one column
whether or not anyone has started; the `started` distinction moves to the row,
where the fleet already reports it as a worker state. Smallest model, and the
board loses a distinction some operators use to see queue depth at a glance.

### What is not in question

**The branch-level phase stays.** A three-branch plan with one branch built and
two untouched is in Development *as a plan* while those two are not; collapsing
that would put `Development` beside *eligible — nobody has taken it*. That
derivation is correct and is not what this plan disputes.

### Open Points

- [ ] Which of A, B or C — the operator's call, and the reason this plan stops
      at Draft rather than proposing a branch.
- [ ] If B: does an existing plan enter the new phase retroactively, or only
      plans created after it? A phase nothing can be in is the defect this plan
      is about.
- [ ] Does `plot-fleet-scan.sh` need the same vocabulary? It reports wave
      eligibility, not phases, so possibly not — but `/plot-implement` prints
      phase names to humans.

## Branches

<!-- Deliberately empty. The three options above are mutually exclusive and
     the choice is a modelling decision, not an implementation detail. A branch
     written before that choice would be a guess wearing a spec. -->

## Notes

Found by an operator asking a narrower question — how two branches of one plan
can show different phases — and following the answer past its own boundary. The
narrow answer is in `the-row-says-what-it-knows`; this is what the answer
revealed.

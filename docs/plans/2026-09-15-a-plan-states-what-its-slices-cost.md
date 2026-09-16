# A plan states what its slices cost

> A slice records what it spent and nothing adds them up, so a plan's cost is a number every reader composes by hand — or, worse, sums across absences that are each honest.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-plan-economics
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-15, jwloka, in-session
- **Started:** 2026-09-15, jwloka, `feature/a-plan-states-what-its-slices-cost`
- **Delivered:** 2026-09-15
- **Released:** 2026-09-16, 2.18.0

## Changelog

- A plan states the tokens its slices spent, summed over the slices that were measured here and naming the ones that were not. Slices have recorded a number since 2026-09-15 and nothing read them together.

<!-- Board impact: a new per-plan reading. No plan format, no template; the
     board may render it, and this plan does not require that it does. -->

## Design

**The inputs shipped today.** `a-slice-says-what-it-spent` delivered
`workflows/slice-spend.ts` with `recordSliceSpend` and `readSliceSpend`, the
`plot-slice-spend.mjs` bundle, and the write site in `plot-worker-loop.sh`. A
slice now carries four token counters and its models.

**Nothing sums them.** Measured on main 2026-09-15: no `planSpend`, no
`spendForPlan`, no per-plan sum anywhere in `packages/domain/src` or
`packages/board/src`. `readSliceSpend` answers for **one branch**.

### The sum is unsound unless the absences are named, and this is the whole design

**A panel found this before the record existed**
(`.plot/panels/2026-09-15-a-slice-says-what-it-spent/panel-r2.md`, `locality`
lens): a rollup over machine-local records is **structurally unsound**, because
*"absences from other machines, reaped desks and SIGKILLed workers are each
honest, and the sum over them is not."*

**The objection stands, and a three-way state does NOT answer it.** Reporting a
count beside a partial sum makes the number **legible**, not **sound**, and those
differ. An earlier draft of this plan treated them as the same thing.

**Measured 2026-09-15, the absences are severely biased:**

```
desk dirs:  live = 4   reaped = 64
REAPED share of output tokens : 92.12%
REAPED share of cache-read    : 91.94%
```

**A desk is reaped when its work LANDS**, so the absences correlate with
**success**. A reader shown *"3 of 5 measured"* reasonably assumes the missing
two resemble the three; on this estate they would be nine tenths of the total.

**What makes the rollup sound is that the gap is a COLD START rather than a
property.** `slice-spend-file.ts:63` resolves the record through
`--git-common-dir`, so **a record survives its desk's reap** — the 64 reaped
desks above predate the record's existence. **The rollup is complete going
forward and empty backward**, and that is the sentence a reader needs.

**One absence stays permanent and must be disclosed.** `seal_declaration` runs
only after `run_bounded` returns 0, so a worker killed by the `Worker bound`
never reaches the write site — **the most expensive runs record nothing.** The
shipped code instructs its successor in exactly these terms
(`slice-spend.ts:53-61`, `plot-worker-loop.sh:1074-1079`):

> *"a rollup over these records is therefore biased LOW in a direction nobody can
> see from the records alone, and a reader must be told so."*

**This plan carries that instruction into its gates rather than restating it in
prose.**

**The three-way state is what makes the disclosure possible.**
`SpendReadState` (`rules/slice-spend-record.ts:19`) is already three-way:

```ts
export type SpendReadState = 'measured' | 'absent' | 'unreadable';
```

This is the same shape as `DeclarationReading`, whose docstring states the rule:
*"cannot answer is not no. This repo has twice shipped a collapse of those two."*

**So a plan's cost is NOT one number.** It is a sum over the `measured` slices,
plus a count of the `absent` ones and a count of the `unreadable` ones. A reader
who sees *"3 of 5 slices measured"* can act; a reader given a bare total cannot
tell a cheap plan from a half-recorded one.

**A plan with zero measured slices reports NO total**, not zero. That is the
`recorded zero is indistinguishable from a free run` rule the slice plan already
carries, applied one level up — and it is the property to pin first.

### Four counters stay apart, and no fifth is summed

The slice record keeps `input`, `output`, `cache_creation`, `cache_read` apart
because **cache reads are 99.36% of a naive four-counter total**, measured over
three transcripts and reproduced by three jurors. A summed fifth field is a
cache-read count wearing a cost's name.

**The rollup inherits that rule exactly**: it sums each counter across slices and
**writes no combined total**. The board may render four numbers; it may not
render their sum.

### It reads records and never a transcript

`readSliceSpend` is documented as opening no transcript, with *"a test pins that
this path opens no transcript"*. **The rollup reads only records**, and inherits
that gate rather than restating it — the whole point of writing once at
`seal_declaration` was that no later reader re-derives.

### The unit is the plan, and its slices come from the plan file

A plan names its branches in `## Slices`; `plot-plan-meta.sh` reports them as
`waves[].branches[]`. **The rollup asks for exactly those branches** rather than
globbing the record file, because a record whose branch no plan names is not this
plan's cost — and because that is the same contract every other consumer reads.

### What this does not do

**No price table, no francs.** The story narrowed itself by measurement on
2026-08-29: a transcript carries four token counters and **no monetary field**.
Re-checked twice since.

**No cross-machine aggregation.** A record is machine-local by settled decision.
This plan makes the absence legible and does not try to fetch it.

**It writes nothing.** A rollup is a read. The records are written by the worker
at `seal_declaration` and this never appends.

**It does not gate anything.** No delivery, release or dispatch consults a cost.

**It does not render.** Nothing reads a per-plan cost today, and the per-slice
read already ships with no consumer. **The render is a follow-up plan** —
`a-plan-shows-what-it-cost`, needing one optional `CardSchema` field and one
component. Naming it is the point: this is the first half of a two-slice
sequence rather than a reading with no reader, and `CardSchema` takes optional
fields routinely, so the destination is unbuilt rather than absent.

## Slices

### A plan states what its slices cost (Branch: feature/a-plan-states-what-its-slices-cost, PR: #919)

- `feature/a-plan-states-what-its-slices-cost` — sum each of the four counters across a plan's measured slices, report the `absent` and `unreadable` counts beside the total, and answer *no total* for a plan with nothing measured

**Done when** a plan whose slices are all `measured` reports the four counters
summed per counter, pinned by a fixture; **no combined fifth total is written**,
pinned by a key-set assertion rather than prose, the same gate the slice record
carries; a plan with a mix reports the sum over the `measured` slices **and the
counts of `absent` and `unreadable` separately**, pinned by a fixture holding one
of each, since collapsing those two is the failure `DeclarationReading`'s
docstring says this repo has shipped twice; **a plan with zero measured slices
reports no total rather than zero**, pinned explicitly; the branches summed are
the ones the plan names in `## Slices` and a record naming an unlisted branch is
ignored, pinned by a fixture; **no transcript is opened**, pinned by the same
kind of test `readSliceSpend` already carries; a plan whose record file is
missing entirely reports every slice `absent` rather than failing; and
`pnpm run test:contracts` passes.

## Notes

**The W41 Should, and it was ticked in error on 2026-09-15** when
`a-slice-says-what-it-spent` delivered — the item's text names that plan's slug
and `plot-deliver.sh` matched it. Unticked the same day after measuring: that
slice shipped 2,375 insertions and no per-plan sum. **The item names no plan of
its own, so nothing mechanical could have caught it.**

**Deliberately drafted after its dependency landed**, which the sprint note
called for: *"trivial once a-slice-says-what-it-spent records a number and
worthless before"*. The inputs are now facts on main rather than intentions.

**Amended 2026-09-15 after a three-lens panel**
(`.plot/panels/2026-09-15-a-plan-states-what-its-slices-cost/panel.md`),
unanimous `amend`. **The premise held** — the second plan this week whose
citations reproduced. The panel found the bias measurement above, the cold-start
distinction that answers it, and a gate resting on a test that does not exist.

**A defect in the DELIVERED slice, to be filed separately:**
`a-slice-says-what-it-spent` demanded *"a test that fails if a refresh path opens
a `.jsonl`"*, its docstring asserts that test exists, and it does not. It was
merged as #918 and delivered today. **The gate self-certified** — prose claiming
a gate reads exactly like a gate, and CI was green because nothing checked.

**The panel's objection is answered rather than dismissed.** `locality` was right
that a sum over machine-local records is unsound; what makes it sound is refusing
to produce a bare total, which the three-way `SpendReadState` already supports.

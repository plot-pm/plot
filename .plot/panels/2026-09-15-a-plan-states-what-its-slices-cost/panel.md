# Panel — a-plan-states-what-its-slices-cost

Subject: `docs/plans/2026-09-15-a-plan-states-what-its-slices-cost.md` (Draft)
Lenses: premise, soundness, consumer. Reconciliation: **unanimous — amend**.

## The premise holds — the second this week

**`premise`: *"Unlike the six false-premise plans this week, this plan's citations
reproduce."*** Verified independently: `recordSliceSpend` and `readSliceSpend`
exist, `SpendReadState` is three-way, and no per-plan sum exists anywhere.

Two caveats, both flagged as *unverified* rather than false: the
`DeclarationReading` *"twice shipped a collapse"* wording could not be located
(the nearest real instance is `slice-spend-record.ts:14-17`), and one gate rests
on a test that does not exist — below.

## A finding about the DELIVERED slice, not this plan

**`readSliceSpend`'s docstring asserts a gate that was never built.**
`slice-spend.ts:89-92` says *"a test pins that this path opens no transcript"*.
Measured by the moderator across all four spend test files: **zero hits.**

**And `a-slice-says-what-it-spent`'s own `Done when` demanded it** — *"pinned by
a test that fails if a refresh path opens a `.jsonl`"*. It was merged as #918 and
delivered today.

**The gate self-certified.** Prose claiming a gate reads exactly like a gate, and
CI was green because nothing checked. It survived a five-round panel, a merge
review and delivery, because every reader read the docstring rather than the test
file. **That is this estate's own `rules vs gates` distinction, and it is a
defect to file rather than a detail of this review.**

This plan then inherits the phantom: its gate says *"pinned by the same kind of
test `readSliceSpend` already carries"*, so an implementer copies nothing.

## The decisive finding: legible is not sound, and the bias is severe

**`soundness` measured it and the moderator reproduced it:**

```
desk dirs:  live = 4   reaped = 64
REAPED share of output tokens : 92.12%
REAPED share of cache-read    : 91.94%
```

**A desk is reaped when its work LANDS**, so the absences correlate with
**success**, not with failure. A reader shown *"3 of 5 measured"* reasonably
assumes the missing two resemble the three; on this estate they would be nine
tenths of the total.

**So the plan's central inference is wrong.** Reporting a count beside a partial
sum makes the number **legible**, not **sound** — and the plan treats those as
the same thing where it says *"the shipped vocabulary answers it"*.

**The shipped code already instructs its successor, and the plan did not carry
it.** `slice-spend.ts:53-61` and `plot-worker-loop.sh:1074-1079` both state:

> *"a rollup over these records is therefore biased LOW in a direction nobody can
> see from the records alone, and a reader must be told so."*

`grep` over the plan for `bound|biased|other machine` returns **one hit**, quoting
the panel, and nothing in `## Design`, `Done when`, or the changelog. **The plan
read the file it cites and dropped the one instruction that file gives it.**

### But the bias is a cold start, not a permanent property

**`soundness` also corrected the plan in its favour**, and the moderator verified
it: the adapter resolves the record through **`--git-common-dir`**
(`slice-spend-file.ts:63`), so **a record survives its desk's reap.** The prior
panel's decisive finding was applied when the slice was built.

**So the 92% gap is historical** — 64 desks reaped before the record existed —
and the rollup is *complete going forward, empty backward*. **That is the
sentence the plan must carry**, and it is stronger than the one it has.

**What stays permanent is narrower:** a bound-killed worker never reaches
`seal_declaration`, so the most expensive runs still record nothing.

## The consumer gap: right refusal, wrong size

**`consumer` found the per-slice read already ships with no consumer** — the only
hits outside the domain are bundle-path arrays in generated output. **This plan
proposes a second one.** There is no field, no schema entry, no render site, and
W41 queues nothing that would read it.

**It endorses the refusal to bundle a render**, and distinguishes it from the
rejected sibling sharply: that plan's destination *did not exist and two
producers deleted it by name*; here the destination is merely **unbuilt**, and
`CardSchema` takes optional fields routinely.

**What it asks for is one sentence.** The plan names the `absent`/`unreadable`
split, the low bias and the four-counter rule — and then names the consumer gap
without sizing it. *"The render is `a-plan-shows-what-it-cost`, needing one
`CardSchema` field and one component"* converts this from *a reading with no
consumer* into *the first half of a two-slice sequence*.

## What the lenses had in common

**All three accepted that a per-plan cost is worth having**, and none asked
whether four counters with no price table answer a question anybody has. The
story narrowed itself to tokens by measurement, so the question is settled — but
it was settled before any record existed, and no juror re-opened it.

## What this panel asks for

1. **Replace *"the shipped vocabulary answers it"*.** Legible is not sound. Say
   the rollup is **complete going forward and empty backward**, and that a
   bound-killed run records nothing permanently.
2. **Carry the docstring's instruction into `Done when`**: a reader must be told
   the sum is biased low. Nothing currently pins it, and an implementation
   reporting `measured: 3, absent: 2` passes every gate.
3. **Replace the phantom no-transcript gate with a real test**, and **file the
   missing gate on the delivered slice** — that is a defect in shipped code.
4. **Size the consumer in one sentence**, naming the follow-up plan.

**Amend and ship.** The premise holds, the design is close, and the work is worth
doing. What must not ship is the claim that the objection is already answered.

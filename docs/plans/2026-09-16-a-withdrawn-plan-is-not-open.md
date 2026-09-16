# A withdrawn plan is not open

> The estate counter reads a rejected plan as open, because `planStatus`'s `default:` arm has no case for a plan somebody decided not to build. The sprint counter grew that case in v2.15.0 and the estate one did not.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** the-domain-knows-what-plot-knows
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A plan somebody rejected or superseded reports as withdrawn rather than open, so the board's estate count says how much work is actually outstanding.

<!-- Board impact: the counter in the sprint control changes, and every plan
     card whose plan is withdrawn gains a status nothing rendered before. No
     plan format, no template, no helper script. -->

## Design

**Measured 2026-09-16 on this estate: the board reports `14 open` and the
correct answer is 0.** Eight plans are `Rejected`, three are `Superseded`, and
three files were not plans at all — those three are already gone, moved to
`docs/notes/` in `fe39198e`, which is what takes the number from 14 to 11.

**The eleven that remain are every withdrawn plan on the estate.**

### The rule has no case, and its own neighbour says why that is wrong

```ts
// rules/phase.ts:140
export const planStatus = (readings: PlanReadings): PlanStatus => {
  switch (readings.phase) {
    case 'released':  return 'released';
    case 'delivered': return 'delivered';
    case 'approved':  /* … three refinements … */
    default:          return readings.review === 'pr' ? 'open' : 'draft';
  }
};
```

`default:` catches four phases the parser emits by name —
`plot-plan-meta.sh:370` matches `rejected|superseded` explicitly, beside
`design` and a file with no phase at all.

**`phaseOfPlanState`, 100 lines above it in the same file, states the rule this
breaks:**

> `null` rather than a default: a state this does not know is a plan format the
> workflow does not understand, and putting it in Discovery would answer a
> question nobody could answer.

Answering `draft` for a rejected plan is that same invented answer, in the
function next door.

### The vocabulary already exists, one scope away

[`a-withdrawn-item-is-not-open`](2026-09-07-a-withdrawn-item-is-not-open.md)
shipped in **v2.15.0** and added exactly this case — to the SPRINT scorer:

| derivation | vocabulary |
|---|---|
| `entities/sprint.ts:43` | `done · open · disputed · **withdrawn**` |
| `rules/phase.ts:140` | `released · delivered · deliverable · in-progress · approved · open · draft` |

That plan names `planStatus` and `estateTotals` **zero times** — the estate half
was never in its scope. Its own measurement read *"three Rejected and three
Superseded"*; the estate now holds eight and three.

**So this is not a new idea, it is the second half of a shipped one**, and the
first half is the model to follow rather than a design to re-argue.

### The schema documents seven values and a rule the code does not have

`schema.ts:325` tabulates each value against what it is measured from, and the
`draft` row reads *"phase draft, no plan PR"*. A rejected plan is not phase
draft. The table is already right; the code does not implement it.

**That enum is otherwise argued with unusual care** — `reviewing` is
*"DELIBERATELY ABSENT"* with a paragraph saying why, `deliverable` earns its own
section. A withdrawn plan has neither a value nor a stated reason for having
none. **An absence with no argument beside it is a gap, not a decision.**

### What the change costs

**Four files name `PlanStatus`** — `rules/phase.ts`, `contract/schema.ts`,
`server/board.ts`, `server/fleet.ts` — and measured 2026-09-16 there is **no
`Record<PlanStatus, …>` anywhere**, so no exhaustive map turns a new member into
a compile error the way `RowKind`'s two tables do.

**Exactly one consumer compares a status value**: `board.ts:1978`,
`status === 'deliverable'`. Nothing else branches on one, so a new member
changes no existing behaviour by itself.

**The board's COLUMNS are `Phase`, not `PlanStatus`** (`phaseDateOf`,
`board.ts:1075`). This plan does not move a card between columns; it changes
what a card's status says and what the estate counter counts.

### What this does not do

**It does not gate anything.** `status: deliverable` must never satisfy a gate —
`schema.ts` argues that at length — and the same holds here in the other
direction: the release gate reads `phase`, and a `withdrawn` status must not
become a second way to answer a question `phase` already answers.

**It does not change the sprint scorer.** That derivation is correct, shipped,
and has a corpus test. This plan brings the estate side to it, never the reverse.

**It does not touch `plot-plan-meta.sh`.** The parser already reports both
phases by name; nothing about the plan format changes.

**It does not decide what a withdrawn card looks like.** Whether such a plan
renders in a column, in a fold, or not at all is a rendering question with its
own reader; this plan makes the status expressible and the count correct.

## Slices

### A withdrawn plan is not open (Branch: bug/a-withdrawn-plan-is-not-open)

- `bug/a-withdrawn-plan-is-not-open` — add `withdrawn` to `PlanStatusSchema`, give `planStatus` a case for the `rejected` and `superseded` phases, count it outside `open`/`wip`/`done` in `estateTotals`, and document the value in the schema's table beside the seven

**Done when** a plan whose phase is `rejected` reports `status: withdrawn` and
one whose phase is `superseded` does too, each pinned by a test; **the estate
count on this repository falls from 11 open to 0**, asserted as a number rather
than as a property, since every other gate here is satisfiable by plumbing a
value through and never counting it; `total` still equals the sum of its buckets
with the new one included, pinned by a test; a plan in every other phase reports
**byte-identically** to today, pinned across all seven existing values; `status
=== 'deliverable'` at `board.ts:1978` is unchanged and the Deliver control still
appears for exactly the plans it appears for today; the release gate's verdict on
this repository is unchanged, asserted by running it; the schema's seven-row
table gains its eighth row with the measurement behind it; and `pnpm run
test:contracts`, `pnpm run test:board` and `pnpm run typecheck` pass.

## Notes

**Found 2026-09-16 by the operator reading the board** — *"Why 14 open plans?
aren't they kinda done?"* — which is the whole finding: a counter that says 14
when the answer is 0 is one a reader learns to ignore, and an ignored counter is
worse than an absent one.

**The plans themselves are in good order.** Ten of the eleven carry a dated
withdrawal record naming a person and a reason; the eleventh gained one in
`fe39198e`. Nothing about the lifecycle failed here — only the reading of it.

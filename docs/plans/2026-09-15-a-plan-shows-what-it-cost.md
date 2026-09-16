# A plan shows what it cost

> A plan's cost is computed and rendered nowhere, so the only reader is a test — the same shape that has now shipped twice on this story.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-plan-economics
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- A plan's card says how much of its cost was measured. The counters have been computable since the rollup landed and nothing displayed them; the card leads with coverage, because four raw counters are read at a glance as their largest.

<!-- Board impact: this IS a board change — one optional Card field, one
     reading in board.ts, one render in PlanCard. No plan format, no template. -->

## Design

**This plan exists because a panel named it.** Reviewing
[`a-plan-states-what-its-slices-cost`](2026-09-15-a-plan-states-what-its-slices-cost.md),
the `consumer` lens found that **the per-slice read already ships with no
consumer** — the only references outside the domain are bundle-path arrays in
generated output — and that the rollup would be a second one. Its ask was one
sentence naming the render; **this is that plan**, and it is written so the
sequence closes rather than extending.

### The destination exists, and that is measured rather than assumed

**A rejected sibling on this story asked to render onto a row that does not
exist** — `the-deploy-job-shows-on-main`, whose destination was filtered out by
two producers and whose `build` RowKind had no arm. **This is not that.**

- `CardSchema` (`contract/schema.ts:357`) already carries **six optional
  fields** in its first block alone, and more below — `sprint`, `story`,
  `assignee`, `started`, `rounds` among them. An optional field is routine work,
  not a precedent this plan has to set.
- `PlanCard.tsx` already renders card-level facts, and it is reached from **two
  live sites** — `Board.tsx:253` and `Swimlanes.tsx:225`. **Both are in scope**,
  because a field that appears on one board view and not the other is a defect a
  reader finds before a test does.
- **`planStatus` (`board.ts:973`) is the precedent for a plan-level fact**, and
  its own comment states the split this plan follows: *"THE READINGS ARE TAKEN
  HERE, THE DECISION IS NOT… that split is why the rule is testable without a
  `FleetReading` and why this function has nothing left to get wrong except
  which pulse it read."*

**So the shape is settled by an existing neighbour rather than invented.**

### The card leads with COVERAGE, and the counters sit behind it

**The rollup refuses a bare total by construction** — `PlanSpend.tokens` is a
four-key record with no sum field, and `planSpend` returns `tokens: null` rather
than zeros, because *"`reduce(…, 0)` over nothing is correct arithmetic and a
lie"* (`plan-spend.ts:118-120`).

**An earlier draft inherited that refusal in the data and lost it in the render.**
Measured over a real plan, the four counters span **five orders of magnitude**:

```
in 502 · out 107,182 · cache-write 528,331 · cache-read 40,690,450
```

**The largest is 81,000× the smallest, so a two-second reader reads the big one**
— the cache-read count, which `plan-spend.ts:36` calls *"a cache-read count
wearing a cost's name"*. **Not summing is not the same as not being read as a
sum**, and a key-set assertion gates the arithmetic while gating nothing about
what the eye does.

**So the card's glance-level text is the coverage**, not the magnitude:

```
measured on 3 of 5 slices        ← the card
not measured here (2 absent)     ← when tokens is null
```

**The four counters remain available** — on hover or in the plan modal, where a
reader who wants them has asked for them and is no longer glancing.
`planSpendSummary` (`plan-spend.ts:127`) already composes the full sentence and
already refuses a number where nothing was measured; the card uses its coverage
clause and defers the counters.

### What the underlying rollup provides

The rollup answers a **measured sum plus two counts** — `absent` and
`unreadable` — and refuses a bare total, because the absences correlate with
success: measured 2026-09-15, **64 of 68 desks are reaped and hold 92% of all
tokens spent**, and a desk is reaped when its work lands.

**The card inherits that refusal.** A plan with three of five slices measured
shows the sum **and** that two are unmeasured. **A plan with nothing measured
shows no cost at all, never a zero** — the rule the record carries at every
level below this one.

**And the four counters stay apart.** Cache reads are 99.36% of a naive
four-counter total, so a single summed figure is a cache-read count wearing a
cost's name. The card shows the counters it is given; it computes no fifth.

### The cost is read once per board build, never per refresh

`readSliceSpend`'s gate — **built 2026-09-15** after its docstring promised a
test that did not exist — pins that the read opens no transcript. **This plan
inherits that gate rather than restating it**, and adds the one it needs: the
card's cost comes from the rollup, and a render path opens no record file per
refresh either.

### What this does not do

**No price table, no francs.** The story narrowed itself by measurement on
2026-08-29 and it has held through three re-checks.

**It does not decide anything, and its own destination file argues against that.**
`CardSchema:378-383` and `PlanCard:99` both say *"a number nobody acts on is the
crowding this board keeps removing"* — so this plan proposes, on that card, the
thing that card's own code names as removable.

**The answer is the coverage framing above rather than a rebuttal.**
`measured on 3 of 5 slices` is not a number to act on; it is a statement about
whether the estate's own record is complete, which is the question a reader of
this board already asks about every other field. **A bare cost would be the
crowding; a coverage line is a data-quality signal.** If that distinction does
not survive contact with the rendered card, this field should be removed rather
than defended.

**It does not aggregate across machines.** A record is machine-local by settled
decision; the card says what this machine measured and how much it could not.

**It renders on the plan card only.** Slice-level cost on a branch row is a
separate question with its own space problem, and bundling it would put two
layout decisions in one plan.

## Open Questions

- [ ] **Does an unmeasured plan show nothing, or a muted "not measured here"?**
  Showing nothing is the safest and least informative; a muted note explains a
  blank a reader will otherwise wonder about. **Does not block:** either
  satisfies the no-zero rule, and the render is one line apart.

## Slices

### A plan shows what it cost (Branch: feature/a-plan-shows-what-it-cost)

- `feature/a-plan-shows-what-it-cost` — add an optional cost field to `CardSchema`, take the reading in `board.ts` beside `planStatus`, and render it on `PlanCard` with the unmeasured counts

**Done when** a plan whose slices are measured shows **its coverage** on its card
— `N of M slices measured`, not the counters — pinned by a browser test asserting
the rendered text contains no counter value; **the four counters are reachable
without leaving the board**, pinned separately, so the refusal to show them at a
glance is not a refusal to show them; **the reading is hoisted ABOVE the per-plan
loop**, pinned by a counting stub asserting `lines()` is called **once per board
build** — `planStatus` is called inside `for (const meta of metas)` at
`board.ts:1969` and the adapter caches only its directory, so a literal
"beside `planStatus`" is N file reads per refresh; **the field follows the
`rounds` precedent** (`4c7e3cab7`) — optional, no-zero, attached with
`!== undefined` rather than a truthiness test, since a measured zero is a real
answer; **a plan with unmeasured slices shows the counts
beside the sum**, pinned separately, since a sum alone is the misreading the
rollup refuses; **a plan with nothing measured shows no cost rather than a
zero**, pinned explicitly; **no fifth summed figure is rendered**, pinned by a
key-set assertion on the Card rather than by reading the DOM; the field is
**optional and a payload without it renders exactly as today**, pinned by a test,
because every existing board must be unaffected; **the cost is read once per
board build and no render path opens a record file**, pinned the way
`readSliceSpend`'s own gate is — a counting stub asserting zero calls, not a
returned value; the reading is taken in `board.ts` and the decision stays in the
domain, following `planStatus`; and `pnpm run test:contracts`, `pnpm run
typecheck` and the board suite pass.

## Notes

**The second half of a two-slice sequence.** The first,
`a-plan-states-what-its-slices-cost`, is Approved and building; **this plan must
not be dispatched before it merges**, because its reading does not exist yet.

**Amended 2026-09-15 after a three-lens panel**
(`.plot/panels/2026-09-15-a-plan-shows-what-it-cost/`), unanimous `amend`. Every
hop of the render path was verified to exist — the contrast with the rejected
`the-deploy-job-shows-on-main`, where two hops were negatively verified. Three
findings: the card must lead with coverage rather than four counters; the Design
and the `Done when` pointed in **opposite directions** on where the reading is
taken; and the "six touchpoints" worry does not apply, since that figure is for a
board **capability** that gates an action, where this is a display field with its
own measured precedent in `4c7e3cab7`.

**Five amendments from the board lens**, all to the gates and one sentence of the
slice: the hoist, a one-`lines()`-call gate, the no-slices case, the two render
sites, and the optional-field count. **None changed the scope or the
destination.**

**The operator settled the render shape**: a coverage line at the glance, the
counters a click away.

**Named by the `consumer` lens** in that plan's panel
(`.plot/panels/2026-09-15-a-plan-states-what-its-slices-cost/panel.md`), which
endorsed the refusal to bundle a render into the rollup and asked only that the
follow-up be sized: *"one `CardSchema` field and one component"*. Measured here
and the estimate holds.

**Closes the story.** `plot-plan-economics` has been `active` since its first
plan delivered today; with a rendered cost the story's objective — *Plot could
already source the number and never stated it* — is answered end to end.

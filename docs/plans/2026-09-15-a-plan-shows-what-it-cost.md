# A plan shows what it cost

> A plan's cost is computed and rendered nowhere, so the only reader is a test — the same shape that has now shipped twice on this story.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-plan-economics
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A plan's card shows what its slices spent, with the counts of slices that were not measured here. The number has been computable since the rollup landed and nothing displayed it.

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

- `CardSchema` (`contract/schema.ts:357`) already carries **four optional
  fields** — `sprint`, `story`, `assignee`, `started`. An optional fifth is
  understood work.
- `PlanCard.tsx` already renders card-level facts; the component exists and is
  reached.
- **`planStatus` (`board.ts:973`) is the precedent for a plan-level fact**, and
  its own comment states the split this plan follows: *"THE READINGS ARE TAKEN
  HERE, THE DECISION IS NOT… that split is why the rule is testable without a
  `FleetReading` and why this function has nothing left to get wrong except
  which pulse it read."*

**So the shape is settled by an existing neighbour rather than invented.**

### What is rendered is not one number

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

**It does not decide anything.** No gate, no delivery check, no dispatch input
reads a cost. It is shown.

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

**Done when** a plan whose slices are measured shows its four counters on its
card, pinned by a browser test; **a plan with unmeasured slices shows the counts
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

**Named by the `consumer` lens** in that plan's panel
(`.plot/panels/2026-09-15-a-plan-states-what-its-slices-cost/panel.md`), which
endorsed the refusal to bundle a render into the rollup and asked only that the
follow-up be sized: *"one `CardSchema` field and one component"*. Measured here
and the estimate holds.

**Closes the story.** `plot-plan-economics` has been `active` since its first
plan delivered today; with a rendered cost the story's objective — *Plot could
already source the number and never stated it* — is answered end to end.

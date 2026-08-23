# A split plan says it is split

> One plan's waves are scattered across attention sections, and each plan head renders as though it were the whole plan. A wave named with a sentence then collides with the cells beside it.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A plan whose waves sit in more than one section now says so, instead of rendering a plan head per section that each reads as the whole plan. A wave whose name is a sentence no longer overlaps the cells beside it.

<!-- Board impact: board-only. packages/board/src/app/components/AgentList.tsx
     (the plan-head grouping and the wave row's name cell). Rebuild the artifact. -->

## Motivation

Measured on the running board, 2026-08-23.

### The split is invisible

The board groups rows by **attention section** first (WAITING ON YOU, WORKING,
DONE …) and by plan within a section. A plan whose waves are in different states
therefore renders **one plan head per section**, and each head shows only that
section's waves while looking exactly like a complete plan.

`waiting-on-you-says-what-kind-of-waiting (6)` renders in DONE holding *Offered
first*, *Shaped* and three *Moved* waves. Nothing on that head says the plan
also has rows elsewhere, and nothing on the other head says it continues here.

**The counts themselves are honest**, which is what makes this hard to see:
`a-folded-row-still-says-what-matters (4)` really does have four branches and
all of them are in that section; `a-dispatch-hands-over-a-brief (3)` likewise.
So a reader cannot use the number to detect the split — sometimes the head IS
the whole plan and sometimes it is half of one, and the two render identically.

That is the defect: not a wrong number, but **an unstated partiality**. A reader
deciding *what is left in this plan* from one head gets an answer that is right
for the section and wrong for the plan, with no signal telling them which they
are looking at.

### A wave named with a sentence overlaps its neighbours

Three rows in DONE render text on top of itself:

```
k Moved — recorded here so the plan states what it started  ‖ deferred ‖ …
```

The wave really is named `Moved — recorded here so the plan states what it
started` — 53 characters, parsed straight out of the plan's `### ` heading.
The row's name cell is sized for a word (*Shaped*, *Gated*, *Folded*), so the
sentence runs under the status and age cells beside it.

**Two separate faults meet here**, and only fixing both helps:

1. **The cell does not contain its content.** Whatever the name, a row must not
   paint over its neighbours — that is a layout invariant, not a matter of
   naming discipline.
2. **The name is a sentence.** `### Moved — recorded here so the plan states
   what it started` is a heading written as prose; the parser has no way to know
   it was meant as a wave name plus a rationale.

## Design

### Say the plan is split, on both heads

Where a plan renders in more than one section, each head states it — in the
section's own terms, since that is what the reader is looking at:

```
▶ PLAN  waiting-on-you-says-what-kind-of-waiting  5 of 6 waves · 1 in WORKING
```

The other head carries the mirror. Both are true statements about the same plan,
and neither pretends to be the whole of it.

**Why not merge the plan into one section instead:** because the sections are
the board's primary organisation and they are right — a wave being worked and a
wave nobody has taken are different calls to action, and forcing them into one
row would lose the distinction the sections exist to draw. The split is correct;
its silence is the bug.

### Contain the name

The wave name cell clips its content, as every other cell on the row does. This
is the same class of defect as `the-name-track-holds-the-name`, which found the
plan slug clipping at a fixed `12rem` while the branch beside it rendered in
full — **check that plan before implementing, and follow whatever it settled**
rather than inventing a second answer to the same question.

The full name stays available on hover (`title`), so clipping loses nothing a
reader cannot recover.

### And say when a wave name is prose

A wave name is a label — *Shaped*, *Gated*, *Folded*, *Offered first*. A
53-character sentence is a plan-authoring mistake that the board can only
render badly.

`plot-plan-meta.sh` should report a wave name over some length, and the
reconcile sweep should surface it, so the plan gets fixed rather than the board
being asked to make prose fit a label's cell. **This is a report, never a
refusal**: the name is already in the estate, and a parser that rejected it
would make an existing plan unreadable rather than untidy.

The threshold is a judgement — the longest legitimate name here is *Offered
first* at 13 characters, and the offender is 53.

### Open Questions

- [ ] Should the split marker name the other section (`1 in WORKING`) or only
      state that there is one (`part of this plan is elsewhere`)? Naming it is
      more useful and costs width the row does not have; decide against the
      row's real geometry, not in the abstract.
- [ ] Does the fold interact? A split plan folded in one section and open in
      another is two different states for one plan, which may be fine or may
      read as inconsistent.

## Done when

- A plan with waves in two sections renders a marker on **both** heads saying so.
  Asserted with a pulse that puts two waves of one plan in different sections —
  the assertion must fail if only one head is marked, since marking the "source"
  head alone is the tempting half-fix.
- A plan wholly inside one section gains **no** marker. Otherwise the marker
  means nothing.
- A wave named with 53 characters clips inside its cell and paints over no
  neighbouring cell. Asserted on geometry (the name cell's box against the
  status cell's), not on the string — a test asserting the text is shortened
  passes an implementation that still overlaps.
- The full name is recoverable on hover.
- A wave name past the threshold is reported by the reconcile sweep, and the
  report does not fail the parse.
- `pnpm run test:board` green; artifact rebuilt and committed.

## Branches

### Contained

- `bug/the-wave-name-stays-in-its-cell` — the wave name clips like every other cell and keeps its full text on hover; follow whatever `the-name-track-holds-the-name` settled about the shared row geometry

### Stated

- `feature/a-split-plan-says-so` — both heads of a plan spread across sections say the plan continues elsewhere
- `feature/the-sweep-names-a-prose-wave` — `plot-plan-meta.sh` reports an over-long wave name and the reconcile sweep surfaces it, without failing the parse

## Notes

Reported from the running board, 2026-08-23: *"we mix waves for a plan that
shows up in different sections"*, with two screenshots.

The counts were checked before writing this and are **not** the defect —
`(4)` and `(3)` are both correct for their plans. Recorded because the obvious
first reading is that the tally is wrong, and a branch sent to fix the tally
would find nothing and might "fix" a correct number.

The overlapping-text rows were confirmed against the estate rather than the
screenshot: `plot-plan-meta.sh` parses that plan's second wave as
`Moved — recorded here so the plan states what it started`.

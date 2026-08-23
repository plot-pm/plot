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

### Say how many waves are elsewhere — and show none of them

A plan head in a section states the count of its waves that are **not** here,
and renders only the waves that belong to this section:

```
▶ PLAN  waves-name-themselves  (2/3)   Development
        WAVE  Parsed   #321  infra/the-parser-reads-a-wave-heading  complete
        WAVE  Written  #330  infra/the-template-writes-waves        complete
```

The live shape, measured 2026-08-23: three waves — `Parsed` and `Written`
complete in DONE, `Migrated` eligible in NOT STARTED. The head shows `(2)`,
which is honest about the section and silent about the plan, so a reader sees
two complete waves and nothing saying a third exists.

**As a TUPLE in the count the head already has, not a second element.** The head
renders `(2)` today; it becomes `(2/3)` — *two of this plan's three waves are
here*. Three characters, no new component, and it replaces the `1 wave
elsewhere` phrasing this plan first proposed, which needs sixteen to say less.

```
▶ PLAN  waves-name-themselves  (2/3)   Development
```

**A count, not a destination.** `(2/3)` rather than `1 in NOT STARTED`: the
number is what tells a reader whether this head is the whole plan, which is the
question. Naming the section costs width the row does not have (see
`the-name-track-holds-the-name`) and invites the reader to go somewhere the row
they want is already waiting for them under its own plan head.

**One notation, read the same way in every section.** In DONE, `(2/3)` says a
wave is unfinished; in NOT STARTED, `(1/3)` says two are elsewhere. The reader
learns one rule — *this head is part of a larger plan* — rather than a
per-section vocabulary.

**Not a progress bar, and the refusal is the same one this board has made
twice.** A bar over 2–6 units has too few states to read as progress, and the
activity mark's docstring records why the shape keeps being rejected: rotation
and traversal *"imply progress toward completion, which nothing here measures"*.
Waves are not units of equal size — `Migrated` in `waves-name-themselves` is an
85-file migration and `Written` was a template edit — so a half-filled bar
claims a plan is halfway done when it may be a twentieth done by effort. **The
count is honest; a bar interpolates.**

Measured 2026-08-23, and it decides the cost question too: **4 of 38 plans span
more than one section**, and the median plan has 2 waves (max 6). A dedicated
progress element on every head would pay width on 34 plans to inform about 4.
A denominator on a count that is already rendered costs nothing on the other 34,
because `(3/3)` and `(3)` are the same width and the same news.

**And the elsewhere waves are NOT rendered here.** A wave belongs to the section
its state describes, once. Showing an in-progress wave under DONE is what put
`merged — wave still open` beneath a heading that says done — the defect
`done-holds-what-is-still-yours` fixes. This must not reintroduce it in the name
of completeness.

> This replaces an earlier proposal in this plan to mark both heads with the
> other's section name. The operator's form is better and the reason is worth
> keeping: a count answers *is this all of it*, which is what a reader of a
> section head is asking, while a destination answers *where is the rest*, which
> they can get by scrolling. Two heads each naming the other also reads as one
> thing split in half; a count reads as a whole with a part elsewhere.

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

- [x] Should the split marker name the other section, or only count? **Count** —
      settled by the operator 2026-08-23: *"tell me how many WAVES are missing
      as a number, but don't show the still-in-progress waves here."*
- [ ] Does the fold interact? A split plan folded in one section and open in
      another is two different states for one plan, which may be fine or may
      read as inconsistent.

## Done when

- A plan head whose plan has waves in other sections renders the tuple — the
  live shape is `waves-name-themselves`, so its head in DONE reads `(2/3)`.
  Asserted on rendered text.
- A plan wholly inside one section renders the **plain count**, not `(3/3)`.
  A denominator that is always present stops being a signal, and this is the
  assertion that keeps the tuple meaning *something is elsewhere*.
- The head renders **only** this section's waves. Asserted as absence: the
  elsewhere wave must not appear under this head, since rendering it is the
  defect `done-holds-what-is-still-yours` removes and "show everything" is the
  tempting reading of *say it is split*.
- Every head of a split plan carries the count, not just one — a reader arriving
  at either section gets the same answer.
- The denominator is the plan's TOTAL wave count, never the row count.
  `every-section-has-one-subject` renders 4 rows over 3 waves, so its denominator
  is 3.
- **A wave that appears in two sections is counted once, on both heads.**
  `every-section-has-one-subject`'s `Inverted` is a two-branch wave with one
  branch merged and one open, so it renders in DONE and in NOT STARTED. Both
  heads read `(3/3)` under a naive numerator, which would say *all here* on two
  heads that each show a part.

  Settle this with `done-holds-what-is-still-yours` before implementing: under
  its wave-verdict rule `Inverted` is not complete and leaves DONE entirely, at
  which point DONE reads `(2/3)` and NOT STARTED `(1/3)` and the tuple is
  well-defined again. **The two plans must agree here, and this is the case that
  proves whether they do.**
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

- `feature/a-split-plan-counts-what-is-elsewhere` — each head of a plan spread across sections states how many of its waves are not in this section, and renders none of them
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

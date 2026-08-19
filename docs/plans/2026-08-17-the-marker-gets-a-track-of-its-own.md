# The activity marker gets a track of its own

## Status

- **Phase:** Delivered
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-19, Jan Wloka, plan-PR #196 merged
- **Started:**
- **Delivered:** 2026-08-19, jwloka, the track landed 2026-08-17 in `120a9bc` — see Notes
## Problem

Reported from a screenshot minutes after the travelling dot landed: *the
indicator works but needs more space.* It does, and it is being cut in
half.

### The marker outgrew its hiding place

Measured, `AgentList.tsx:1539`:

```
relative flex h-5 w-3 shrink-0 items-center self-center
sm:absolute sm:left-0 sm:top-2
```

A **12 px track** (`w-3`) pinned at `left-0` — the row's very edge. The
row's own padding is `px-3`, so the marker sits inside it, and the
section's border clips what extends past the edge. The screenshot shows
the result: a half-circle at the left margin.

**This worked until today.** The mark was a 4 px stroke when it was
placed there, and a stroke at `left-0` has nothing to lose. The
travelling dot needs room to travel, and the room it was given belongs to
the row's frame rather than to the row.

### The reason it lives outside the grid, and why that has expired

The code states the choice and its cost:

> *"Beside the live dot in the row's left padding **rather than in a
> track of its own** — … the reason the six columns do not move to make
> room for a mark most rows never carry."*

That reasoning is sound and remains measurable: **2 of 56 rows carry a
marker** in the current pulse. A dedicated track indents fifty-four rows
to serve two.

What changed is the other side of the trade. A mark that is *clipped* is
not a cheaper mark — it is a broken one, and the cost of the workaround
is now paid by the two rows that matter rather than by the fifty-four
that do not.

## Design

### A seventh track, first in the row

```
1.25rem  6rem   10rem  1fr     14rem   2.5rem  1.25rem
marker   phase  plan   branch  status  age     menu
```

The marker becomes a cell like any other: it is laid out by the grid, it
cannot be clipped by a frame it does not know about, and it aligns with
every other row's marker cell by construction rather than by an absolute
offset that each caller must get right.

**The cost, measured rather than estimated:** one `1.25rem` track plus
one `0.75rem` gap = **32 px**, taken from the branch column, which is the
only flexible one (`1fr`). Fixed tracks go from 540 px to 572 px.

That is real and it is the price of the choice. It is also bounded: the
branch column already elides in the middle and keeps its full value in
`title`, so 32 px costs a few characters on the longest names and
nothing on the rest.

**`LiveDot` moves into the same cell.** It sits at `sm:left-1` today by
the same absolute mechanism, for the same reason, and leaving it behind
would mean two marks positioned two different ways — the arrangement that
produced this defect. One cell holds whichever marks a row carries.

### An empty cell leaves a gap, not a shift

The property `agent-rows-line-up` established, applied to the new track:
a row with no marker renders an **empty** first cell, not a missing one.
Fifty-four rows will have one, and they must line up with the two that do
not.

This is what makes the indent survivable: it is uniform. An indent that
appeared only on marked rows would be worse than the clipping.

### What this does not change

**Nothing about what the marker means.** `isActive`, the lock echo, the
two speeds, the `top-2` alignment and the `motion-reduce` rule all landed
today and are untouched. This is a layout change.

**No other section.** All six waiting-groups share one row
implementation, so the track applies everywhere at once — which is the
point, and why no group can drift.

**The mobile card is unaffected.** Below `sm` the row is a stacked card
and the tracks do not apply; the marker flows inline as it does today.

## Branches

### Track

- `bug/the-marker-gets-a-track-of-its-own` — `ROW_TRACKS` gains a leading
  `1.25rem` column; the activity marker and `LiveDot` move into it; an
  empty cell leaves a gap

## Done when

- **The marker is not clipped.** Assert its full width renders inside the
  row — the reported defect, visible as a half-circle today.
- **The marker is a grid cell**, not an absolutely-positioned element.
  Assert it has no `sm:absolute` / `sm:left-*`.
- **`LiveDot` shares the cell.** Assert a row carrying both shows two
  distinct marks, and that neither is positioned absolutely.
- **A row with no marker leaves an empty cell.** Assert its phase column
  starts at the same x as a marked row's — the pairing that matters: a
  fix that adds the track only where a marker exists indents two rows out
  of fifty-six and misaligns the section.
- **All six waiting-groups get the track.** Assert alignment in a group
  other than WORKING.
- **The branch column absorbs the 32 px.** Assert the other fixed tracks
  are unchanged and only `1fr` shrinks.
- **Below 640px nothing changes.** Assert the stacked card at 375px is
  identical to today.
- **The marker's behaviour is untouched** — two speeds, `top`-alignment
  no longer needed, `motion-reduce` keeps it, `aria-hidden`.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
  `pnpm run validate` all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present, with its `bumps:` block.

## Notes

Delivered without an implementation branch, and the reason is worth recording
rather than hiding behind a tidy record.

The work landed on 2026-08-17 at 23:47 in `120a9bc` — *"board: the Agents tab
can act, and the marks get a column"* — **two days before this plan was
approved**. `ROW_TRACKS` gained its leading marks column there, and
`ACTIVITY_MARK_PLACE.row` lost its `sm:absolute sm:left-0`. Every Done-when
criterion was already met by code nobody wrote against this plan.

Two details differ from the design, both in the direction the plan would have
chosen had it known: the track is `1rem` rather than `1.5rem`, because 1.5rem
plus a sixth gap crossed the 640px card breakpoint by exactly 8px, and the
phase column gave up 1rem to pay for it.

What this plan DID contribute was found on delivery: `120a9bc` changed the code
and left the old rationale standing. The doc comment still described the
`sm:absolute` placement as "UNCHANGED, to the character" directly above the
flow-layout string that replaced it. A reader trusting the comment would have
learned the opposite of what the code does. That is removed as part of this
delivery — the third instance today of a decision changing while its written
reason stayed put.


The comment this plan overturns was right when it was written and is
worth keeping in the file as history: a 4 px stroke genuinely did not
need a column, and fifty-four rows genuinely should not indent for two.

What made it expire is that the mark grew. The measured density —
**2 of 56** — has not changed, so the argument against a track has not
weakened; the argument for one has simply become stronger, because the
alternative is now a marker that is cut in half by the frame it was
tucked behind.

Recording that because the next mark this board adds will face the same
question, and the answer will depend on its size rather than on this
precedent.

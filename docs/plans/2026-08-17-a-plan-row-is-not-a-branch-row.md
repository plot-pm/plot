# A plan row is not a branch row, and the grid should say so

## Status

- **Phase:** Delivered
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-19, Jan Wloka, plan-PR #195 merged
- **Started:**
- **Delivered:** 2026-08-19, jwloka, in-session against the running board
## Problem

Reported from a screenshot of NOT STARTED, hours after the section
learned to count plans: *the nesting looks wrong.* It does, and the data
is not.

### Four sibling plans, rendered as a hierarchy

The pulse holds four plans and five branches, cleanly separated:

```
activity-shows-itself               feature/group-shows-inner-activity
activity-shows-itself               feature/unpushed-work-shows-still
not-started-says-what-it-waits-for  feature/not-started-says-what-it-waits-for
working-rows-show-their-pace        feature/the-line-flashes-on-any-written-update
plot-sprint-support                 feature/plot-sprint-support
```

Four plans, all siblings. The screenshot reads as a tree:

```
plot-sprint-support                 1 wave, first eligible        6mo
  Design  feature/plot-sprint-support        eligible…            6mo
    ▸ activity-shows-itself         2 waves, first eligible       today
      not-started-says-what-i…      1 wave, first eligible        today
  Design  feature/not-started-says-what-it-waits-for              today
```

`activity-shows-itself` appears indented beneath another plan's branch,
as though it belonged to it.

**The DOM is right.** Measured: each plan is its own
`<li role="rowgroup">`, with its branches in a nested `<ul>`. There is no
containment in the markup, and **no indentation anywhere in the file** —
`grep` for `pl-`, `ml-` and `indent` finds two hits, neither related.

### The grid manufactures the hierarchy

`PlanRow` uses the **same `ROW_TRACKS`** as a branch row:

```
6rem     10rem   1fr      14rem    2.5rem  1.25rem
phase    plan    branch   status   age     menu
```

A branch row fills column 1 (`Design`) and column 3 (the branch name). A
plan row leaves column 1 empty and puts the plan's name in column 2.

So the plan's name starts at `6rem` while the branch above it starts at
`0`. **The eye reads that offset as nesting**, because a consistent
indent is what nesting looks like — and the offset is perfectly
consistent, since both rows share the same tracks.

Nothing is nested. The columns are simply doing what they were built to
do, to two kinds of row that are not the same kind of thing.

### It is the inverse of the defect `agent-rows-line-up` fixed

That plan's whole argument was that **like things must start at the same
x** — rows drifted because content-sized cells let each row begin
wherever its neighbour ended, and a fixed grid fixed it.

Here, **unlike things start at different x** and therefore read as
related. The same mechanism, the opposite failure: alignment that was
built to express *these are the same* is being read as *this one is
inside that one*.

## Design

### The plan row occupies the row, not a column of it

A plan row is not a row of the same table. Its cells do not correspond:
it has no phase, no branch, no PR — it has a **name**, a **wave
summary**, and a **clock**. Forcing those into six tracks designed for a
branch produces an empty first column, and the empty first column is the
whole defect.

So the plan row **starts where the row starts** and lays its three facts
out in its own proportions:

```
◆ plan-name                    2 waves, first eligible          6mo
```

Its own line, beginning at the section's left edge, exactly like the
group headings this board already draws for WAITING ON YOU and friends.
That is precedent rather than invention: **a heading is not a row**, and
a plan row is a heading that happens to carry a clock.

**The branches keep the six tracks unchanged.** They are branch rows,
they line up with branch rows in every other section, and that alignment
is what #175 established. Nothing about them changes.

### The relationship is shown by rhythm, not by offset

With the plan row spanning the width, a reader needs some other cue that
the branches below belong to it. The board already has one and uses it
for its sections: **the group is a bordered block**, and rows inside it
share that block.

So a plan and its branches sit in one bordered group, and the next plan
starts a new one. No indent is added — an indent would re-create the
thing being removed, and would compete with the fold's own expander.

**Indentation was the obvious fix and is rejected.** Making the branches
*more* indented would resolve the visual ambiguity by declaring the
hierarchy real. But the branches are not children of the plan row in any
sense the rest of the board honours — they are the same branch rows every
other section renders flush, and indenting them here would break the one
property `agent-rows-line-up` bought: that a branch starts at the same x
wherever it appears.

### What this does not change

**No data change, no contract change.** The grouping, the sort, the wave
summary and `waitingDays` all landed correctly and are not touched.

**No change to the fold.** `showsWaveFold` and the expander stay as they
are — including the rule that a one-branch plan gets no expander.

**No other section changes.** Only NOT STARTED renders plan rows.

## Branches

### Layout

- `bug/a-plan-row-is-not-a-branch-row` — the plan row spans the row's
  width in its own proportions instead of borrowing the branch tracks;
  plan and branches share one bordered block; branch rows unchanged

## Done when

- **A plan row starts at the section's left edge**, not at the plan
  track. Assert its first cell begins where a branch row's phase cell
  begins.
- **Four sibling plans read as four siblings.** Assert the live shape —
  four plans, five branches — produces no visual containment between
  plans. The pairing that matters: an implementation that only removes
  the empty first cell still leaves the plan name at `6rem` and reads as
  nested.
- **Branch rows are unchanged.** Assert a branch row in NOT STARTED
  aligns with a branch row in WAITING ON YOU, column for column — the
  property #175 established and this must not spend.
- **A plan and its branches share one bordered block**, and the next plan
  starts a new one.
- **No indentation is introduced.** Assert the branches' left edge is
  identical to every other section's.
- **The fold is untouched** — a two-wave plan has an expander, a
  one-wave plan does not, and opening it reveals the branch names.
- **The sort and the clock are untouched.** Assert `plot-sprint-support`
  still sorts first with its 6-month `waitingDays`.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
  `pnpm run validate` all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present, with its `bumps:` block.

## Notes

The section's behaviour is correct and only its geometry is wrong, which
is why this is a narrow bug rather than a revision of #191. Counting
plans, sorting by the plan clock, summarising the waves and folding the
branches all work — the screenshot that reported this is also the first
one in which `plot-sprint-support` finally shows its six months.

The mechanism is worth recording because it inverts a fix this repo
already paid for. `agent-rows-line-up` gave the rows a fixed grid so that
**like things start at the same x**. Applying that grid to a row that is
*not* like the others makes **unlike things start at different x** — and
a consistent offset is indistinguishable from an indent. The grid did
exactly what it was built to do; it was simply asked the wrong question.

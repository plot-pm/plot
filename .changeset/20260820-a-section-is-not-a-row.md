---
"@plot-pm/board": minor
---

board: a section heading is drawn larger than the rows it introduces

Measured in a rendered board on 2026-08-20, and the defect is worse than it was
reported. The section `<h2>` was `text-xs` — **12px** — while the row it
introduces is `text-sm` and its branch name renders **13px**. The strongest
structural break on the page was not merely equal to the weakest thing inside
it; it was set *below* it. The plan `<h3>` under the section was `text-[11px]`,
smaller still, so the three levels were ordered exactly backwards: heading 11 <
section 12 < row 13.

**The report said "the same size"; the screen said "smaller".** The plan's table
recorded row text at 12px, which is true of a row's *supporting* cells — the
kind, the PR state, the age. It is not true of the branch name, which is the
row's subject and its most prominent text. A fix aimed at clearing 12px would
have left the heading level with the thing a reader actually scans. This is why
the sizes were re-measured in the browser rather than taken from the table, and
why the test asserts against the **largest** size a row draws.

**This is the second half of a finding whose first half already landed.**
`bug/the-row-shows-what-it-withholds` (#290) measured the same shape for
*spacing* — 16px between sections against 35px between rows — and fixed it with
`space-y-8`. It did not touch type size. Spacing separated the sections; size
now distinguishes them, and the two are independent: either can be undone
without disturbing the other, which is why both are asserted in one file.

**The caret comment was right, and about a different property.** The existing
comment defends `py-1 -my-1` as making the heading a 24px-tall target, noting
*"the caret is what a reader aims at"*. That reasoning is about the **click
target** and it holds — the padding is untouched and the button still measures
at least 24px. The operator's complaint (*"expand / collapse icons still too
small"*) is about **seeing** the glyph. A control can be easy to hit and hard to
read; those are separate properties, and only one of them changes here. The test
measures the button's height as well as the glyph's size, so a later "bigger
caret" that reached the glyph by trimming the padding fails rather than passes.

**The same comment's consistency argument is what prevented the hierarchy.**
*"A board that uses 12px 82 times"* argues for sameness, and sameness across
levels is precisely why three of them read as one. Consistency within a level is
right; most of those 82 occurrences are rows, and the rows do not move.

**Two sizes for three levels, decided from a rendered board.** The plan left
open whether the plan heading needs a size of its own between the section's and
the row's. It does not: that heading sits inside a tinted, outlined box holding
exactly its own rows, and the container states *inside a section* more plainly
than a third type step would. Spending a distinction on a level the layout
already draws buys nothing. What the heading did need was to stop being the
smallest text on the page — a label set under the branch names it labels is the
section's defect one level down — so it moves to 13px, level with those names
and still below the section.

**The changes, all in `AgentList.tsx`.** The section `<h2>` goes `text-xs` →
`text-sm` (14px) with `mb-1` → `mb-2`, because 4px under a 14px line reads
tighter than 4px under a 12px one and the space below a heading belongs to the
heading. The section fold caret goes `text-[13px]` → `text-[15px]` — a step
above the heading it opens, because a triangle has no x-height or stem to fill
the em and reads smaller than text at its own size — in a `w-3` → `h-4 w-4` box,
since a box cut for a 13px mark clips a 15px one and can shift its pivot when it
rotates. The plan `<h3>` goes `text-[11px]` → `text-[13px]`.

**What deliberately did not change, each of them measured after the fact.** Row
height, at 37–38px, which #290 states explicitly and a reader's scan depends on.
The `space-y-8` section separation, still 32px between sections. The `py-1
-my-1` padding and the 24px floor on the fold target. Nothing in the contract —
this is CSS, no payload field moved.

**The heading line is 4px taller, and that is the change rather than a side
effect of it.** The button measures 28px where it measured 24px, because the
label's line box follows its font size. `-my-1` cannot absorb that and was never
meant to: it cancels the `py-1` beside it, not growth in the content itself. The
floor the earlier work established is *at least* 24px and it is still cleared;
the rows, which are what the density argument protects, are untouched.

**The tests fail against the old code.** All three sizing assertions were run
against the pre-fix classes and failed; the fold assertion passes on both, being
a guard rather than a defect-catcher — growing a heading's type is exactly the
kind of edit that turns a `<button>` into a `<span>` by accident. Each size
assertion is stated twice over: as a comparison, so re-tuning the scale later
does not require re-tuning the test, and against the measured number, so the
comparison cannot be satisfied by a row *shrinking* to meet a heading that never
moved — the wrong repair for this finding, and the one that costs the board its
density.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side rendering change only. No helper
script decides how a section is drawn, `/api/fleet` loses and gains no field,
and the plan format is untouched.

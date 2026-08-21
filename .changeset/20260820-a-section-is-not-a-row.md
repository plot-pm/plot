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

**Two of the three changes landed on main while this branch waited, and what
remains is the third.** This branch proposed `text-sm` (14px) for the section
`<h2>` and `text-[15px]` for its caret. Before it could merge, `main` answered
the same defect at `text-base` (16px) for both and darkened the heading colour
with it. That is what ships: a heading two type steps clear of its rows rather
than one, and `mb-2` under it either way, because 4px under a 16px line reads
tighter still than 4px under 12px did. The `w-3` → `w-4` widening of the caret's
box is on main for the same reason it was proposed here — a box cut for a 13px
mark clips a larger glyph and can shift its pivot when it rotates.

**So the surviving change is the plan `<h3>`: `text-[11px]` → `text-[13px]`.**
Main fixed the section and left the level below it, which was the smallest text
on the page — a label set under the branch names it labels. It now sits level
with them.

**Two hands reached for the same property and differed only on distance.** The
convergence is worth recording: this branch measured a rendered board and
concluded the section heading was set below its own rows; main measured the same
board and concluded the same thing, then moved one step further. Neither fix
knew about the other. A defect that two independent readings find, and find in
the same direction, is a defect rather than a preference — and the tests below
are what keep it fixed, since they assert the *ordering* of the levels and not
any of the three numbers proposed for it.

**What deliberately did not change, each of them measured after the fact.** Row
height, at 37–38px, which #290 states explicitly and a reader's scan depends on.
The `space-y-8` section separation, still 32px between sections. The `py-1
-my-1` padding and the 24px floor on the fold target. Nothing in the contract —
this is CSS, no payload field moved.

**The heading line is taller, and that is the change rather than a side effect
of it.** The button grew past its former 24px because the label's line box
follows its font size. `-my-1` cannot absorb that and was never meant to: it
cancels the `py-1` beside it, not growth in the content itself. The floor the
earlier work established is *at least* 24px and it is still cleared; the rows,
which are what the density argument protects, are untouched.

**The tests fail against the old code.** All three sizing assertions were run
against the pre-fix classes and failed, and all three still pass against main's
larger step, being comparisons rather than constants; the fold assertion passes on both, being
a guard rather than a defect-catcher — growing a heading's type is exactly the
kind of edit that turns a `<button>` into a `<span>` by accident. Each size
assertion is stated twice over: as a comparison, so re-tuning the scale later
does not require re-tuning the test, and against the measured number, so the
comparison cannot be satisfied by a row *shrinking* to meet a heading that never
moved — the wrong repair for this finding, and the one that costs the board its
density.

**One assertion was rewritten in the rebase, and it was measuring the wrong
thing.** The row's *"the branch name survives the sentence beside it"* check read
`scrollWidth > clientWidth` on the name's outer span. That was correct when a
name was one span. It is not any more: `BranchLabel` folds a long name in the
middle — a `truncate` head that gives up width beside a `shrink-0` tail that
never does — so a clipped head is the *mechanism*, and the outer span overflows
by design whenever a name is long enough to fold. Measured for
`feature/give-them-away` in its 81px slot: outer scroll 94 against client 81,
because the head collapsed to 0px and handed every pixel to a 94px tail that
clipped nothing at all. The old measure reported a working fold as a crushed
name, and would have gone on reporting it for every name long enough to need
one.

It now asserts on the **tail**: that it clips nothing, that it is non-empty, and
that it really is the end of the name — because a tail that survives by being
empty passes the width check and identifies nothing, which is the same defect one
step along. The clipped head is deliberately left unasserted; it is the give in
the design, and pinning it would forbid the fold. Verified by mutation: giving
the tail `min-w-0 truncate` fails the check, so it bites rather than passing on
the DOM's shape alone.

This is a cross-branch finding neither branch's CI could see, and main is red
from it **now**. Measured on 2026-08-21 with both suites run concurrently under
the same load: main fails two tests (`one-grid`'s `kinds:` assertion and this
deferral row), this branch fails one — the `kinds:` assertion it inherits. The
name column became a fixed `12rem` track on main while this test waited, so main
carries the narrow slot without the corrected measure and has been failing on it
since. The rebase is what put the two together; the fix travels with it.

**The heading's padding goes `py-1` → `py-0.5`, and the reason changed twice
before it was right.** 2px around a 13px label holds the proportion `py-1` held
around an 11px one; at the new size the tinted band read loose. That is the
reason it keeps.

It arrived, though, as a repayment. Growing the type grew each plan heading's
line box, twice on a page with a group in QUIET and in DONE, and at `py-1` the
footer test failed at **801.3125px** against a bound of 800. Chasing that 1.3px
is what exposed the assertion underneath it.

**The footer assertion was measuring the wrong quantity, and passing for the
wrong reason.** It compared a document coordinate against a literal `800` — the
viewport height, restated three lines below where `setViewportSize` had already
set it. Two independent defects hid in that:

- **It contradicted itself across platforms.** `main` fails it on CI's Linux at
  802.3125 and passes it on macOS: this page renders ~4px taller there, which no
  change in this branch can control. A test a runner moves as easily as a change
  does reports on the runner. The local A/B that first pinned the failure on this
  branch was itself misled by this — main *does* fail it, in CI.
- **It was green over a page that scrolled.** Asked directly, the document runs
  to **813px** in an 800px viewport while the footer bottoms at 797. The footer
  was reachable and the page still scrolled, and the assertion could not tell
  those apart.

It now asks the footer's own box against `window.innerHeight`, with the `± 1`
that every fractional `.3125` in these measurements was asking for. Both halves
are mutation-verified: a 400px viewport fails the *reachable* half, a 4000px one
fails the *back out of reach* half.

**The 13px is a real defect and it is not this one.** The page wrapper carries
`min-h-screen` and starts 13px down the document, so it ends 13px past the fold
by construction on every board. Asserting `scrollHeight <= clientHeight` here
would fail this test for a layout box nobody can see and no collapse can fix, so
the test says in a comment why it does not — and the defect gets its own plan,
`2026-08-21-the-page-is-as-tall-as-the-screen.md`.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side rendering change only. No helper
script decides how a section is drawn, `/api/fleet` loses and gains no field,
and the plan format is untouched.

---
"@plot-pm/board": minor
---

board: the row shows what it withholds

Five display findings measured on the live board on 2026-08-19, all of one
shape — a row stating a fact and withholding its consequence. One branch
rather than five because all five edit `AgentList.tsx`, which conflicted on
every merge that day.

**A section break now reads as a bigger break than a row break.** Measured
before: 16 px between one section's block and the next section's heading,
against 4 px between that heading and its own block — and rows sit 35–36 px
apart. So the strongest structural break on the page was drawn with the
page's weakest signal. The sections now sit in a container of their own at
`space-y-8`; the page container keeps `space-y-4` for the banners, which are
notices about the page rather than sections of it. Row height is unchanged.

**A plan group draws its own edge, so it stops absorbing what follows it.**
Two issue rows (#227, #228) rendered beneath a heading reading
`the-row-says-what-it-knows (5)` and belonged to no plan: they arrive in the
separate `issues` field and render after the plan's branches, and the layout
offered no place where the plan's group ended. A headed group is now a boxed
`rowgroup` — `data-plan-group` — and the rows that follow it in the section
sit visibly outside it. The count beside the plan name and the rows inside
the box now agree.

**The plan row hosts the approval that belongs to a plan.** `ApproveButton`
existed, the server reported `approve: {available: true}`, the card read
`phase: Discovery` — and the button rendered inside the `⋯` menu of a
*branch* row, which a Draft plan never has, because a Draft branch has
nothing to start. So a plan whose whole state was *waiting for a person to
approve it* offered that person nothing to click. `PLAN_ROW_TRACKS` gains a
`1.25rem` actions track (the branch row's own width, so the two line up) and
a one-item menu. Dispatch stays out of it: that argument was about the act
that needs a branch, and it still holds.

**A deferred row states the reason its plan recorded.** Two rows read
`deferred` beside `no commits` and the honest answer — *nothing* — was
never given. The sentence had been in the plan file since the branch was
shelved; `plot-plan-meta.sh` tested only for the annotation's presence.
`deferred_reason` now travels plan file → `plot-plan-meta.sh` →
`plot-fleet-scan.sh` → `deferredReason` on the row, and renders in the row
rather than only in a `title`. A bare `<!-- deferred -->` sets the flag with
no reason, where before it read as not deferred at all.

It renders on the row's own second line — the shape a stuck row already uses
for `conflict / the host reports this branch does not merge`. Two bounded
cells were tried first and both were measured failing: beside the branch name
the sentence crushed `bug/the-no-ref-arm-reads-the-join` to `b… ads-the-join`,
and in the fixed `14rem` note cell `truncate` gave it zero width so it
rendered as nothing at all. A sentence does not fit a column, and the row's
primary key is not the thing to spend on it.

**Every pointer target reaches 24 × 24 px.** Measured before: the fold
toggle was 5 × 10 px at `font-size: 10px`, the `⋯` menu 12 × 12, the PR and
issue links 35 × 16 — 37 elements under 24 px in one direction. Each target
grows by padding the row absorbs, so the glyphs and the row height are
untouched; the fold caret goes from 10px to 13px (10px was the outlier — the
board uses 12px 82 times) and the two fold states are now one glyph rotated
90°, a difference in geometry rather than in typeface.

<!--
bumps:
  skills:
    plot: minor
-->

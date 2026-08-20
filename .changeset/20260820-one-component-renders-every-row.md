---
"@plot-pm/board": minor
---

board: one component renders every row

`Row`, `PlanRow` and `IssueRowView` are replaced by the tuple row, and
`ROW_TRACKS` and `PLAN_ROW_TRACKS` collapse into `TUPLE_TRACKS`. Two grids for
three components becomes one grid for seven kinds.

The measurement that ordered this wave last: **555 + 149 + 2 lines** across
three components, and the third — a TICKET — rendered through the tracks of a
BRANCH, wearing a wave, a worker and a branch it does not have. It wore them
because there was no third grid to give it, and nobody noticed because two of
the seven tracks were empty and the rest were filled with another object's
vocabulary: the kind cell read `Discovery`, a plan PHASE on a row that is not a
plan and has never entered the lifecycle the word comes from. That is the same
defect as the four-meanings phase column, at a second site.

**One component, not a shared grid with three fillers.** Three fill sites is
exactly how the two grids drifted apart, and keeping them while adding a
contract keeps the drift possible. What remains at the three call sites are
ADAPTERS: an adapter answers what only that site knows — the activity marks the
fleet computes for the whole list at once, the menu the kind offers, the second
line a stuck branch takes. The six slots are answered once, in `tuple-row.ts`,
which the unit suite already tests as data. A new kind now costs a projection
and no rendering at all, which is what the deleted three could never do.

**The reversal `PLAN_ROW_TRACKS` records is worth stating rather than quietly
undoing.** Its argument was *a plan row is not a branch row, so it does not
borrow the branch tracks* — correct about its own case, and the reason there
were two grids for what the contract says are seven kinds. The second grid did
not fix the mismatch it was built for; it moved it. What the two were really
arguing about was slot CONTENT, which the tuple settles there: a plan's slot 3
is its name, slot 4 the branch it names one of, slot 5 its PHASE — the object
that fact belongs to — and slot 6 the approval clock. The nesting that grid was
drawn to prevent (eight sibling plans reading as a hierarchy because a plan name
and a branch name both began at 222px) is prevented by slot 2 instead, and more
directly: the two rows differ by the WORD in the kind slot rather than by an
indent a reader has to measure.

It absorbs `feature/the-row-leads-with-its-subject`. With slot 3 holding the
item name, *which fact leads* is answered by construction, so what this branch
does with it is **delete** the per-kind leading logic rather than write a rule
for it.

**Two consequences, named rather than discovered later.** On a row whose kind is
`branch` the PR NUMBER is no longer a link: `tupleFromRow` gives a branch row one
artifact link, its plan. A row is `branch` precisely when the PR cannot resolve
it — a merge conflict — so the reader's destination is the branch, which slot 3
names and links; the PR's CONDITION still reaches slot 5, which is what *a merge
conflict is still readable on the branch it belongs to* asks for, and the number
rides beside it as text. And `planInHeading` is gone rather than kept as a no-op:
a branch row's plan was a whole TRACK, so a headed group suppressed it, but in
the tuple the plan is one of slot 4's links and suppressing it there would leave
a headed group's rows with an empty artifact slot while an unheaded group's
carried a link.

**Every DOM hook the three carried moves with the FACT, not with the component.**
`data-branch` to the branch link wherever it renders, `data-kind` to slot 2,
`data-phase` to the plan row's slot 5, `data-issue-link` to the ticket adapter's
name. Twelve test files find rows by those hooks, and rewriting 48 `data-branch`
assertions onto a `[data-tuple-link="branch"]` text match would trade an exact
attribute lookup for a substring comparison — on names that share twenty-four
characters of prefix in this very fleet.

**The structural gate follows the row into the other file.** The scan that
proves *a row's actions all live in its menu* read `AgentList.tsx` alone,
because every row component lived there; with the rendering one module away it
would have walked from `Row`, failed to find `TupleRowView`, and reported a clean
row while every anchor in the estate sat unwatched. That is the failure the
gate's own docstring warns about — *a scan that matched nothing passes forever
while gating nothing at all* — so it now reads both files, and a new test walks
the tuple from all THREE adapters. Two scanner defects the move exposed:
`stripComments` handled block comments only, so `TupleLinkView`'s prose about
the anchor it declines to render was read as markup; and `indexOf('>')` is not
where a JSX opening tag ends, so the estate's one legitimate anchor was reported
as a stray.

**`TUPLE_TRACKS`'s documented arithmetic was wrong, and computing it in a test
is what found that.** The constant claimed 496px of fixed track needing 580px,
with 60px clear of the 640px breakpoint. Measured: **508px needing 604px, 36px
clear.** One uncounted gap — `84` is five gaps plus padding, correct for six
tracks, and this has seven. No defect shipped, since 604 is still under 640;
what shipped was a margin a later widening would have been checked against, and
it is the same off-by-one-gap error `ROW_TRACKS` records making and warns fails
*in the reassuring direction*.

Membership is unchanged — which section a row appears in is a separate decision
— and no host call is added: every slot derives from what the pulse already
carries.

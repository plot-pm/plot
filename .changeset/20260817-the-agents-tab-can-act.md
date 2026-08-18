---
"@plot-pm/board": minor
---

board: the Agents tab can approve, and the marks get a column

**Approve was unreachable from a row.** `board.approve` has existed since
`board-becomes-operable` and reached the CARDS only — `Board.tsx` and
`Swimlanes.tsx` pass it to `PlanCard`, the Agents tab was never given it.
So a plan PR sitting green and ready showed a dimmed three-dot menu on
its row while the same plan's card offered the button: one board, two
answers about the same act.

Three layers were in the way, and fixing one alone would have changed
nothing:

- `App.tsx` never passed `approve` to the tab
- the menu's gate read `canStart && serverWillAct` — one named action, so
  a Draft plan's row was dead by construction, since such a row is never
  startable
- the menu BODY required `dispatch`, which a Draft row does not have

The gate now asks whether **any** act is available, and each item asks
for its own precondition. Written as two independent items rather than an
if/else: should the two ever overlap, the menu shows both instead of
silently picking one.

**The marks get a track of their own.** They hung in the row's left
padding on the argument that six columns should not move for a mark most
rows never carry — which held while there was one mark. There are five
now, and a row can wear several: measured on screen, the activity track
and the unpushed bar overlapped, and `left-0` is the ROW's edge, which
sits outside the section's border, so every mark straddled the panel.

The cell is unconditional while its contents are not, so a markless row's
six other cells do not shift. A seventh track costs its width AND a sixth
gap, which crossed the 640px card breakpoint — the phase column gave up
1rem to pay for it. The test that caught this predicted the day in its
own comment; its gap constant is now derived from the track count rather
than hard-coded, because `84` was right for six tracks and silently wrong
for seven, in the reassuring direction.

<!--
bumps:
  skills:
    plot: patch
-->

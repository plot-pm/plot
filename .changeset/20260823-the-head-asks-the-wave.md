---
'@plot-pm/board': patch
---

board: the plan head's wave count asks the server's Wave, not the rows

The plan head summarised its waves — *"3 waves, first eligible"* — by
re-grouping its own rows with `groupByWave`. That was a second answer to a
question `the-contract-carries-a-wave` already answers on the server: the
payload now carries a `Wave` per `(plan, wave)`, each placed in the one section
the server derived for it. A wave whose branches span sections could be counted
one way here and another way in DONE, which is the derivation-disagreement class
`the-wave-is-a-thing-the-board-can-hold` exists to close.

`waveSummaryFor` now reads `fleet.waves` — counting the plan's waves the server
placed in `not-started` — rather than re-grouping the rows in front of it. A
merged wave the server put in DONE is no longer counted under the plan head even
if one of its rows lingers there, and a blocked wave IS counted (it is unstarted
work waiting on an earlier wave, which the `open`-only row filter dropped).

`first eligible` stays a row fact from `isStartable`, the predicate the row menu
reads, so the summary cannot promise an action the menu refuses. Where the
payload carries no `waves` — a pre-wave server, whose field the board casts to
`undefined` rather than `[]` — the head falls back to the row derivation, so an
older server keeps working.

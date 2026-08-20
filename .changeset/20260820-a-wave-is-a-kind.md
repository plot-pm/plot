---
"@plot-pm/board": minor
---

board: a wave is a kind, and its status is not a sentence

The scan has emitted `{name, verdict, branches}` per wave since waves
existed. The board read the name onto the branch row as a string, dropped
the verdict onto that same row as a nullable field nothing rendered, and
then rebuilt the verdict as English in `blockedNote()`. Every piece was
already on the wire.

Measured on the mock before the change: a three-wave plan rendered four
rows all labelled `PLAN`, each naming its **branch** with the wave name as
a trailing badge, each linking `PLAN fleet-scan-asks-the-host` — directly
beneath the plan row heading those three rows — each showing `open` where
the scan had computed `eligible`, `blocked`, `blocked`, and one spelling
`blocked by Shaped — 1 outstanding` in prose one line below the `Shaped`
row itself.

`wave` becomes the eighth kind, with Octicons' `stack` for its glyph. A
wave row names the wave, carries the scan's verdict as its status, and
links its **branches** — unprefixed, and with no link to its plan, because
the plan is the row it is nested under and that placement is the statement.

The sentence `blocked by Relocated — 1 outstanding` was three facts, and
each now has a slot: `blocked · 2 left` is the verdict with the wave's own
count in slot 5, `— blocked by Relocated` is a **reference beside the
name**, and the count moved to the **Relocated** row, which is the wave it
counts. A wave holding three others back used to print that count three
times, each time describing a row the reader had to find by name.

The reference took three placements to land, each rendered before the next
was tried. Slot 4 as a link put a pointer **up** among links pointing
**down**, in a column headed `Related` whose every other kind reads one
direction. Beside the name it was worse than crowded: `Relocated` rendered
as `R…` and `Moved` as `M` — the blocker text won the width fight against
the name, so the row lost the one thing it exists to say. It is now an
**info mark beside the status**, with the wave in the tooltip and in the
accessible label: `blocked` is what a reader scans down the column, and
*which wave* is a follow-up about one row.

**What a container states, its children do not repeat.** A row inside a
wave's fold showed `open`, its own age, a link to the plan two rows up, and
`blocked by Relocated — 1 outstanding` — four facts already on screen
above it, all four now suppressed. The status one is worth naming: a first
attempt suppressed only `state === 'open'`, and counted over the estate
that guard **never fires** — a child row renders only inside a multi-branch
unfinished wave, there is exactly one, and all five of its branches are
`wip`. A rule beat the exception list. (The branch state says nothing about
startability anyway: inside `blocked` waves its branches are `open` × 9 and
`wip` × 5; inside `eligible` waves, `open` × 8 and `wip` × 3.)

A **deferred** branch is not a wave's unbegun work and keeps its own row
beside the waves — `isUnbegun` already drew that line, and a wave row shows
the wave's verdict and clock, so a deferred branch folded into one would
lose the PR and age that appear nowhere else.

**Counted in waves, not in rows.** `waveSummaryFor` printed
`${rows.length} wave(s)` — the unit name was right and the number was of
something else, so this estate's five-branch wave would have reported
`5 waves` for a plan whose file lists one. `showsWaveFold` had the same
defect: a fold promising five and revealing one.

Measured over `last-pulse.json` — 35 plans, 71 waves — to decide whether a
wave row replaces its branches or sits above them: 57 waves hold one
branch, 14 hold more, and of those 14 **thirteen are `complete` and one is
`blocked`**. All 11 `eligible` waves hold exactly one. So one row is the
common case and the fold is the exception; a wave holding several gets its
own disclosure, and its branches indent beneath it.

Also: the link prefixes in slot 4 (`PLAN`, `BRANCH`, `PR`) are now the same
Octicons that name those kinds in slot 1 — one vocabulary read in two
columns instead of a word and a glyph for one fact. Slot 2 keeps the row's
own kind as a **word**, so a row is never iconography alone.

Two fixture defects surfaced and are fixed: the mock carried four
`kind: 'plan'` rows, a kind `rowKind` never returns and no pulse has ever
emitted — it read correctly only while a not-started row stood for its
plan. And six of the estate's 71 waves have no name, so a nameless wave
renders `(unnamed)` as text rather than failing: the board is not where a
plan-authoring convention is enforced.

<!--
bumps:
  skills:
    plot: patch
-->

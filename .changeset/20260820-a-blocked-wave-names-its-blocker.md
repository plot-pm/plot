---
"@plot-pm/board": minor
---

board: a blocked wave's row names how many branches it waits on

`blocked by Fold` already named WHICH wave a row waits for. It did not say how
many branches are left in it, so a reader learned the blocker's name and nothing
about how close it is to clearing. The row now reads `blocked by Fold —
2 outstanding`: the same sentence, with the number the scan already computes.

The count is the blocker wave's non-deferred, unmerged branch count — the exact
predicate `plot-fleet-scan.sh`'s Pass 2 settles a wave on, so the board's number
and the scan's verdict read one fact rather than two that can drift. The scan
ships the wave's branch list rather than a count, so the board derives it, which
is where Manifesto Principle 3 puts the interpretation: the scan collects, the
board counts.

`blockedNote()` gains the count as an optional second argument and appends it
only where the wave is named. An UNNAMED blocker keeps the bare *blocked by an
earlier wave*: the count answers *how many are left in THAT wave*, and "that
wave" is only referable once it has a name — a dangling *— 2 outstanding* on a
nameless sentence would attach a number to a wave the reader was never given. A
plan with a single wave cannot be blocked at all (there is no earlier wave to
wait on), so it is never reached and shows no count.

`rowsFromPulse` derives the count once per plan, beside the blocker name it
already resolved — both answer the same reader's question about the same wave,
and computing them together keeps the name and the number from disagreeing.
Nothing new reads the prose: `verdict` and `blockedBy` remain the fields a
consumer reads, and this only sharpens the sentence a person sees.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change only. No helper script is
touched. `blockedNote` gains an optional argument, so every existing caller is
unchanged and the `/api/fleet` payload keeps its shape — the sentence a row
carries is longer, not differently typed.

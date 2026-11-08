---
'@plot-pm/board': patch
---

fleetd's snapshot now carries every reading the board's fleet view needs: the plan walk's stage answers, branch dates, idea plans, release versions, unmerged and claim-only branches, and desk questions. `fleetViewFrom` derives the board's pulse, ages, approval dates, branch links and PR maps from it with the same rules the board runs today. The snapshot protocol is 2. Nothing changes for an operator yet: the board still serves from its own reads.

<!--
plan: docs/plans/2026-11-09-board-reads-the-channel.md
-->

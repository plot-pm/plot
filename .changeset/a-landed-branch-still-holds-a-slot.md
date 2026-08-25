---
"@plot-pm/board": patch
---

<!--
bumps:
  board:
    "@plot-pm/board": patch
-->

fix(board): count live agents with landed branches against the cap

`liveAgentCount` and `liveAgentBranches` now count every live agent regardless
of whether its branch has merged. A live agent holds a machine (CPU, memory,
worktree) until it exits, not until its work lands — the slot is occupied by
the process, not by the work.

Measured 2026-08-25: eleven workers whose branches had merged sat at zero CPU
for up to ten hours, none counted against the cap, letting the fleet grow to 13
against a cap of 3. The earlier "liveness takes two facts" rule inverted the
defect by hiding landed agents from the cap while they held their machines.

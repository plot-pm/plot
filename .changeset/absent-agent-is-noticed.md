---
'plot': minor
'@plot-pm/board': patch
---

The fleet reports an agent whose process has gone, instead of reporting it `running`. The reading is whether an agent process exists anywhere under the recorded pid, never the wrapper's own liveness: the recorded pid is the loop shell, and `kill -0` on it succeeds for the whole `Worker bound` whether or not an agent runs inside. Measured 2026-09-11, four agents ended mid-slice in one session and every one reported `running`; three left 8 commits and 9 uncommitted files one step from done. `liveness` gains `orphaned`, which the desk classifies — `stalled`, `waiting` or `finished` — because an unexited wrapper has written no exit code and the desk is the only thing left to read. A wrapper younger than `PLOT_AGENT_GRACE_SECONDS` is unaskable rather than absent, so a starting agent is never mistaken for a stopped one. The readings parser now recognises the liveness word instead of defaulting it to `dead`, which silently reported a whole live fleet as dead.

<!--
plan: docs/plans/2026-09-12-a-failed-gate-becomes-a-correction.md
bumps:
  skills:
    plot: minor
-->

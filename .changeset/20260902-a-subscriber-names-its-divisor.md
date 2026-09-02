---
'@plot-pm/board': patch
---

The board's two refresh timers become one clock with two subscribers. `Pulse` is a domain entity now: it beats at 5 s, the fleet scan counts every beat, and the PR reader counts every twelfth — both cadences exactly what they were. The `12` is read off `PR_REFRESH_MS / REFRESH_MS` rather than written down, so moving the base moves the cadence with it. A subscriber that throws or hangs leaves the other's beat untouched, which is the isolation the split timers bought and this keeps.

<!--
bumps:
  skills:
    plot: patch
-->

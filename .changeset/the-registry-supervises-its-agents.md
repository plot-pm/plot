---
'plot': minor
'@plot-pm/board': minor
---

The registry supervises its agents. `plot-registryd` reads the registry and the desks it names on every tick, judges each agent by its declaration and the five gates, and decides: leave a live worker alone, reap a finished desk, hand an unfinished one a correction naming what is missing, or mark a spent one for a person. The tick holds nothing it cannot re-read, so `kill -9` costs one tick and no decision, and a daemon's first tick picks up desks that predate it.

`attempts` and `relaunches` are read separately — the automatic budget reads `attempts` only, so a person's `--restart`s never spend it. A spent budget writes a `PLOT-BLOCKED` marker and stops, which is a visible stop rather than a loop.

Tick interval 60 s, chosen after measuring the tick at 3496 ms for three agents under load.

<!--
bumps:
  skills:
    plot: minor
-->

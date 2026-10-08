---
'@plot-pm/board': patch
'plot': patch
---

A freshly taken-up slice now resolves its own `agent:` charter instead of running under whatever `PLOT_AGENT` named at process start — one worker serves many slices, and a slice naming a different agent now gets that agent's prompt and runner, for both the command and SDK paths. A named agent whose charter cannot be read refuses the take-up and returns the slice to the queue, rather than silently falling back to the start-time charter. Fixes #1169. Also excuses `.plot-worker.continue.md` (the board's hop-between-passes marker) from desk dirtiness, matching `PLOT-CORRECTION.md`'s existing treatment, so a merged desk holding only it is reapable. Fixes #1166.

<!--
plan: docs/plans/2026-10-07-the-fleet-loop-reads-its-runs-right.md
bumps:
  skills:
    plot: patch
-->

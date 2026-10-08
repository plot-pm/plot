---
'@plot-pm/board': patch
'plot': patch
---

The worker loop now surfaces a GitHub Actions run awaiting manual approval as `build needs approval` on the desk, instead of silently waiting with no finding at all: `readPass` carries the pushed commit's run whenever the checks wait reads one, not only once it settles, excluding a run `runWasNotAcquired` reads as a host outage. A waiting run spends no correction and ends no slice, the same as a pending one. The loop also now reads its own `tip-moved` verdict as `head moved`, publishing that finding directly rather than depending on a stale run for a superseded commit. Fixes #1338.

<!--
plan: docs/plans/2026-10-07-the-fleet-loop-reads-its-runs-right.md
bumps:
  skills:
    plot: patch
-->

---
'plot': patch
---

A failed or cancelled CI run where every job ran 0 steps — a host outage, not a code failure — no longer settles the loop's checks wait. `plot-host.sh run-for-sha` now reads each job's step count for a concluded `failure`/`cancelled` run, and the domain's `checksFromRuns` keeps waiting (and eventually answers `no-answer`, never `settled`) rather than spending a correction on it. Fixes #1295.

<!--
plan: docs/plans/2026-10-07-the-fleet-loop-reads-its-runs-right.md
bumps:
  skills:
    plot: patch
-->

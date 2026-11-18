---
'plot': minor
---

A commit on the default branch that changes only Plot's bookkeeping paths or the generated bundles no longer restarts the wait for a settled main. fleetd and `plot-ask.mjs merge` treat it as settled with the commit before it, while its own CI run still feeds the reading.

<!--
plan: docs/plans/2026-11-17-main-merges-more-than-one-pr-per-ci-run.md
-->

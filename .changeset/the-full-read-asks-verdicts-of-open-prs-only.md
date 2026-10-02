---
'@plot-pm/board': patch
---

The board's daily full PR read asks the git host for check, mergeability and review verdicts of the open pull requests only, and keeps the verdicts it already holds for a merged or closed one. Measured 2026-10-01 on this repository, that read took 43.0 s for 1000 rows and 36 s of it bought verdicts about pull requests nobody can act on: all 1000 rows were terminal. Re-measured 2026-10-02 over three runs each, the read takes 12.2-13.5 s against 39.6-42.3 s. A merged or closed row whose verdicts the host was not asked for takes them from the stored row with the same number, and one the store has never held reads as unavailable rather than as passing. The delta between full reads still asks for every verdict, because a pull request that changed is one whose checks a reader may still be reading.

<!--
plan: docs/plans/2026-10-01-a-pr-refresh-reads-the-history-once-a-day.md
-->

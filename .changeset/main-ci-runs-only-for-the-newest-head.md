---
'plot': patch
---

Main CI push runs share one concurrency group and no longer cancel an older head, and the red-main repair names a cancelled candidate instead of reading it as unknown.

<!--
plan: docs/plans/2026-11-21-main-ci-runs-only-for-the-newest-head.md
bumps:
  skills:
    plot: patch
-->

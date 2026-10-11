---
'plot': patch
---

The implement lock is the `running <pid>` state file, taken with O_EXCL and read through pid liveness, so a second process sees the board's run and the dispatch command returns once the implement has started.

<!--
plan: docs/plans/2026-10-10-the-controllers-close-their-review-findings.md
bumps:
  skills:
    plot-dispatch: patch
-->

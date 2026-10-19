---
'plot': patch
---

A `no-answer` ending's `PLOT-BLOCKED.md` question now names a conflicting PR as the reason GitHub never started a build, instead of pointing at the build connector: the CI wait reads the PR's `mergeable` field once on entry alongside its number, carries it in the ending's `detail` string, and `needsPersonMarker` recognises `mergeable=conflicting` to write the real cause.

<!--
plan: docs/plans/2026-10-19-a-desk-waits-for-ci-on.md
bumps:
  skills:
    plot: patch
-->

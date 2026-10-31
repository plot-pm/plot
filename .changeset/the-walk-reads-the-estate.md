---
'plot': patch
---

The plan store parses plan blobs by object name with the configured branch prefixes, and an unreadable plan ref now fails the read instead of answering no plans; the plan walk's estate stage enumerates the default branch's plans, branch-only plans and index links from one snapshot.

<!--
plan: docs/plans/2026-10-31-the-plan-walk-moves-into-the.md
bumps:
  skills:
    plot: patch
-->

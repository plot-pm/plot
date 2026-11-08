---
'@plot-pm/board': patch
---

The domain gains a `Watch` port and a `watchFs` adapter that watch directories only, re-arm after a `rename`, and report `degraded` for a directory that cannot be armed; nothing arms it yet.

<!--
plan: docs/plans/2026-11-09-the-snapshot-entity.md
bumps:
  skills:
    plot: patch
-->

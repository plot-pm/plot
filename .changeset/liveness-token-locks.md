---
'@plot-pm/board': patch
---

The PR reader checks a following board with `process.kill(pid, 0)` instead of starting `ps` on every PR beat. A board owned by another user (`EPERM`) still counts as alive.

<!--
plan: docs/plans/2026-11-09-liveness-token.md
-->

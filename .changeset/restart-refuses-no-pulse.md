---
'plot': patch
---

`plot-restart-command.mjs` and `POST /api/restart` refuse `no-pulse: no current fleet reading to look the branch up in` when they have no fleet reading, instead of `unknown-branch: no plan on this board names that branch`.

<!--
plan: docs/plans/2026-11-04-restart-refuses-unknown-branch-when-it.md
bumps:
  skills:
    plot-dispatch: patch
-->

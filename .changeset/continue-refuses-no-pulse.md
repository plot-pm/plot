---
'plot': patch
---

`plot-continue-command.mjs` and `POST /api/continue` refuse `no-pulse: no current fleet reading to look the branch up in` when they have no fleet reading, instead of `unknown-branch: no plan on this board names that branch`. The board's agent panel reports the same `no-pulse` miss with its own sentence.

<!--
plan: docs/plans/2026-11-04-continue-and-the-agent-panel-refuse.md
bumps:
  skills:
    plot: patch
-->

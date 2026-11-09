---
'plot': patch
---

`plot-restart-command.mjs` starts a new agent on a slice whose PR is a draft and whose worker is dead. It still refuses a non-draft open PR with `reached-review`.

<!--
plan: docs/plans/2026-11-09-restart-refuses-a-slice-whose-dead.md
bumps:
  skills:
    plot: patch
-->

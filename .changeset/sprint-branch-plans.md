---
'plot': patch
---

A plan that only a sprint branch holds is now recorded, started and delivered on that sprint branch. `plot-record-pr.sh` takes `--branch <name>` and, without it, records the PR on the sprint branch `planBaseFor` reads for the plan in the caller's tree. The Implement route, `POST /api/dispatch` and `plot-dispatch-command.mjs` name the plan's sprint branch as `--branch` in the `/plot-implement` prompt (`originPlanHome`). `POST /api/deliver` takes an optional `branch`, reads the plan and its phase at `origin/<branch>`, and starts `/plot-deliver --branch <branch> <slug>`.

<!--
bumps:
  skills:
    plot: patch
    plot-implement: patch
    plot-deliver: patch
-->

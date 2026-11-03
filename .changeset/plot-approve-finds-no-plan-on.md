---
'plot': patch
'@plot-pm/board': patch
---

On Bitbucket, `/plot-approve` and `plot-needs-design` find a plan that exists only on its open plan PR, and `/plot-approve` takes that PR out of draft with `bb pr edit --ready` before it merges. The fleet agent loop takes a finished Bitbucket slice PR out of draft the same way. A `plan-not-found` refusal names the open PRs it could not read, and why.

<!--
plan: docs/plans/2026-11-03-plot-approve-finds-no-plan-on.md
bumps:
  skills:
    plot: patch
    plot-approve: patch
-->

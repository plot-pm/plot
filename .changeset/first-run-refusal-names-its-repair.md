---
'plot': patch
'@plot-pm/board': patch
---

Every refusal on the path from `/plot-init` to `/plot-deliver` names the command that fixes its condition, or the decision the reader must make. `plot-dispatch --stop` now asks git which worktree holds the branch instead of asserting the one path it rebuilt from the branch name, and host refusals take their repair text from the connector that failed, so no message names a CLI the configured stack does not use.

<!--
plan: docs/plans/2026-09-07-a-first-run-refusal-names-its-repair.md
bumps:
  skills:
    plot-dispatch: patch
    plot-approve: patch
    plot-deliver: patch
-->

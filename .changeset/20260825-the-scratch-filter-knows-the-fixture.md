---
'@plot-pm/board': patch
---

fix(@plot-pm/board): the scratch filter knows the test fixture

`PLOT_TOOL_SCRATCH` excluded `.playwright-mcp/`, `.plot/agents/` and `.omc/state/`
but not `.plot/state/`, so the tiny-garden pulse fixture — rewritten by every
board test run — kept worktrees permanently dirty. A worker that only ran its
tests was never dropped by the reconciliation, even with a clean exit.

Added `.plot/state` to the pattern in both `plot-worker-state.sh` and
`registry.ts`, so those four entries drain the way the filter intends.

<!--
bumps:
  skills:
    plot: patch
-->

---
'@plot-pm/board': patch
---

A charter's `harness`, `model` and `effort` reach the launch: an agent may run a different CLI, model or reasoning effort from its siblings in the same fleet. `start_worker` resolves the charter before it reads `Worker command`, exports the three as `PLOT_HARNESS`, `PLOT_MODEL` and `PLOT_EFFORT`, and refuses a charter it cannot believe rather than starting it on an invocation nobody asked for. An agent with no charter exports none of them and its command line is unchanged.

<!--
plan: docs/plans/2026-09-12-an-agent-declares-what-it-runs.md
bumps:
  skills:
    plot-dispatch: minor
-->

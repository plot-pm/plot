---
'plot': patch
---

A started agent leads its own process group. Both launch sites in `plot-dispatch.sh` run under `set -m`, so a wrapper's pid is its group id: a SIGKILL to the dispatcher's group no longer ends the agent, and `--stop` on one agent ends that wrapper's group and no sibling's. An agent started before this change still shares its starter's group, and the own-group guard in `--stop` stays for it.

<!--
plan: docs/plans/2026-10-01-a-start-returns-while-its-agent-runs.md
bumps:
  skills:
    plot-dispatch: patch
-->

---
'plot': minor
---

`/plot-init` provides the four role definitions to an adopting repository. `plot-adopt.mjs roles` writes each missing `.claude/agents/<role>.md` and `.claude/settings/<role>.json` that the plugin ships, leaves an identical file alone, and reports a differing copy `stale` without overwriting it; a second run writes nothing, and a repository that already carries a `## Plot Config` still receives the files it lacks.

<!--
plan: docs/plans/2026-10-29-fleet-roles-are-declared-agents.md
bumps:
  skills:
    plot-init: minor
-->

---
'plot': patch
---

The worker-state manifest lookup resolves the main checkout through `--git-common-dir` and reads the `Agent registry` key. It derived its directory as the desk's `--show-toplevel`/.plot/agents, which inside a linked worktree answers the desk, so every worker-state reading taken from inside a dispatched desk read its agent as unregistered (#1086).

<!--
plan: docs/plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md
bumps:
  skills:
    plot: patch
-->

---
'plot': patch
---

plot-local-checks resolves the repository root through realpath before it builds the `{changed}` paths, so a `vitest related` command names the real path and finds its test in a worktree under a symlinked temp directory (#1317).

<!--
plan: docs/plans/2026-10-07-the-tests-and-sweeps-leave-no-trace.md
bumps:
  skills:
    plot: patch
-->

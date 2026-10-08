---
'plot': patch
---

plot-local-checks resolves the repository root through realpath before it builds the `{changed}` paths, so a `{changed}` path is the real path even when the root reaches it through a symlink. This is a defensive change: the symlinked-temp-directory failure in #1317 does not reproduce through the entry point on macOS, so the issue stays open.

<!--
plan: docs/plans/2026-10-07-the-tests-and-sweeps-leave-no-trace.md
bumps:
  skills:
    plot: patch
-->

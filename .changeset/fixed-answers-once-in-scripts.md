---
'plot': patch
---

A per-desk worker-state probe no longer starts `git rev-parse --git-common-dir` when its caller already knows the answer. `plot-worker-state.sh` takes `PLOT_GIT_COMMON_DIR`, or `$PLOT_REPO_ROOT/.git`, when the first `.git` above its directory is that dir or a desk of it, and asks git otherwise. It exports the answer for the processes it starts, and `plot-dispatch.sh` blanks it for every agent it launches.

<!--
plan: docs/plans/2026-11-08-fixed-answers-once.md
bumps:
  skills:
    plot: patch
-->

---
'@plot-pm/board': patch
---

fix(plot): the worker loop removes its manifest on exit

The worker loop script (`plot-worker-loop.sh`) now removes its manifest file
(`$PLOT_MANIFEST_FILE`) via an EXIT trap on all three exit paths:

1. Normal end — when `--next` returns no more work
2. Break — when a `cd` to a new worktree fails or git worktree add fails
3. Timeout — when the bound fires and the worker is killed

A worker that ends stops appearing in the registry immediately — the board's
next pulse will no longer see its row.

The reconciliation sweep STAYS. A trap cannot run on SIGKILL, so the sweep
remains the thing that catches a worker killed outright (kill -9). The trap
answers "I am leaving" — a cheaper, immediate cleanup. Reconciliation answers
"which entries no longer correspond to anything?" — a periodic sweep that
handles SIGKILL and orphaned manifests from crashes.

<!--
bumps:
  skills:
    plot: patch
-->

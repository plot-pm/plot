---
'@plot-pm/board': patch
---

plot: a blocked marker is a file, not a mention

`plot_worker_blocked` decided `waiting` by grepping every file's CONTENTS for
the marker token `PLOT-BLOCKED:`, and 28 tracked files on `main` contain that
token because Plot documents its own marker — CLAUDE.md and every brief among
them. Every worktree is a checkout of `main`, so every pristine worktree read
`waiting` before any worker ran; the states below it (`finished`, `stalled`)
were unreachable wherever no PR fact masked the false positive, and the board
surfaced a documentation example as a worker's question with a control to
answer it.

The marker is now a FILE: `plot_worker_blocked` looks for a `PLOT-BLOCKED*`
file at the worktree root, and `worker-question.ts`'s `markerIn` reads that
file instead of re-greping with its own copy of the pattern. A document cannot
be mentioned into a file. The duplicated pattern constant is deleted from both
places, `TODO(you|human)` is dropped rather than ported, and the `Worker
command` in CLAUDE.md is tightened to name the `PLOT-BLOCKED.md` file it asks
workers to write, so the instruction and the classifier agree.

<!--
bumps:
  skills:
    plot: patch
-->

---
"plot": patch
---

<!--
bumps:
  skills:
    plot-dispatch: patch
-->

feat(plot): manifest tracks worker's current branch and wave count

When a worker hops to a new branch via plot-worker-loop.sh, the manifest
now updates to reflect:
- The new branch the worker is on
- The new worktree path
- A wavesCount field tracking how many waves the worker has taken

This keeps the registry accurate: readers see where a worker IS, not
where it started. The session and pid stay fixed — it's the same worker,
in a new place.

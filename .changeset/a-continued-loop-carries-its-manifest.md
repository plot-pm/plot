---
'plot': patch
---

`/api/continue` asks `deskManifest` before it writes anything and refuses with 409 when no manifest names the worktree, or when two do, rather than spawning a loop with no `PLOT_MANIFEST_FILE`. A loop with no manifest at all could never end on a vanished registration — `assigned_branch` returns 1 forever and the wait holds the desk for the full `Worker bound`, logging `free on ?`. `wait_for_work` now reads `loop_registration` each poll and ends the wait with reason `unregistered` when a NAMED manifest has since disappeared, while an unnamed (hand-started) loop keeps waiting exactly as before. The stale `.plot-worker.wrapper.pid` a previous dispatch left behind is removed before the spawn, since this route starts no wrapper of its own.

<!--
plan: docs/plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md
bumps:
  skills:
    plot-dispatch: patch
-->

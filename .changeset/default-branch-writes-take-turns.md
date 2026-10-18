---
'plot': patch
---

`plot-push-main.sh` now takes a `mkdir` lock under the common git dir, so default-branch lifecycle writes run one at a time (#1349). A second writer waits up to 120 s (`PLOT_PUSH_LOCK_WAIT`); past that it refuses with the new exit code 6 and names the holder's pid and action. A lock whose holder is dead, or older than 600 s, is broken. Exit codes 0, 1, 3 and 4 keep their meaning, and no caller changes.

<!--
plan: docs/plans/2026-10-17-delivery-reads-the-delivered-plan-and.md
bumps:
  skills:
    plot: patch
-->

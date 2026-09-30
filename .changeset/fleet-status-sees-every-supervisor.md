---
'plot': patch
---

`/plot-fleet --status` names every Plot supervisor, board and top-level scan running on this machine, with the checkout each one serves and the installation it runs from, and counts separately the scans whose parent process has exited. The block follows the `summary:` line and prints only when a process serves another checkout or a scan is orphaned, so the exit code and the summary line are unchanged.

<!--
plan: docs/plans/2026-09-29-fleet-status-sees-every-supervisor.md
bumps:
  skills:
    plot-fleet: patch
-->

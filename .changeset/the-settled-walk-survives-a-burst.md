---
'plot': patch
---

The settled-CI walk on the default branch resumes past the last ancestor it asked, so a burst of more than 5 commits between refreshes settles on an older green commit within a few refreshes instead of re-asking the same newest 5 and holding the previous reading (#1582). The sandbox-scrub test waits for the dispatched worker's recorded pids before removing its temp root.

<!--
plan: docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md
bumps:
  skills:
    plot: patch
-->

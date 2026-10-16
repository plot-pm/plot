---
'plot': patch
---

The settled-CI walk on the default branch resumes past the last ancestor it asked, so a burst of more than 5 commits between refreshes settles on an older green commit within a few refreshes instead of re-asking the same newest 5 and holding the previous reading (#1582). A resumed walk that finds a concluded commit re-asks the newer commits it skipped before it settles, so the settled reading is never green while a newer commit on the default branch answered red, and a new head drops the resume point. The default-branch file stays at version 1 with an optional `walked` field: a process still running an older bundle reads a file that carries `walked` as no reading while a burst lasts: that process holds nothing in the merge queue and `plot-ask.mjs merge` refuse as stale until that process restarts. The sandbox-scrub test waits for the dispatched worker's recorded pids before removing its temp root.

<!--
plan: docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md
bumps:
  skills:
    plot: patch
-->

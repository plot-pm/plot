---
'plot': patch
---

`plot-host.sh run-for-sha` exits 4 when `gh run list` fails, so the BuildMonitor reads an expired token, a rate limit or a network error as unaskable instead of "no run yet". New tests cover the loop's checks wait ending on the pushed commit's answer and the Jenkins arm answering nothing for a commit no build carries.

<!--
plan: docs/plans/2026-10-05-the-build-monitor-asks-for-the-pushed-commit.md
-->

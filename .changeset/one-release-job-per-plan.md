---
'plot': patch
---

`POST /api/release` now refuses with 409 when a release for the same slug is already running, checked before the route truncates that job's log and state file. Previously a second call for a running slug opened the same log with `fs.openSync(log, 'w')` over the first job's still-open file descriptor, so the first job's output landed in a truncated file and its state could be overwritten by the second job's exit code. The refusal is per slug: a release for a different slug still answers 202 while the first is running.

<!--
plan: docs/plans/2026-10-28-parallel-release-calls-exhaust-their-push.md
bumps:
  skills: {}
-->

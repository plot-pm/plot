---
'plot': patch
'@plot-pm/domain': patch
'@plot-pm/fleet': patch
---

`IssueIndex.at` is now optional rather than a required string, and a failed issue-index pass with no held index of the same source and connector now writes no `at` at all instead of inventing one from the failed read's own timestamp — fixing #1845/finding #1652. A failed pass still carries the held `at` forward unchanged where the held index answered the same source and connector and itself carried one. Separately, `registryd-main.ts`'s git-host probe now warns and names the failure before assuming `github`, instead of falling back silently and corrupting downstream cadence/connector tracking on a repository whose host probe fails.

<!--
plan: docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md
bumps:
  skills:
    plot: patch
-->

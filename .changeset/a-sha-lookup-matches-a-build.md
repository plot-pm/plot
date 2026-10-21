---
'plot': patch
---

`jenkins_sha_runs` pairs each `lastBuiltRevision` entry with its `branch[].name` and matches a sha only on the entry for the asked branch, never on the merge-base entry a merge-before-build job also records. `run-for-sha` and `runs-for-sha` no longer bind a `SUCCESS` or `FAILURE` build to a sha it only used as its merge base; a build that stops matching reports as absent, not as a wrong colour.

<!--
plan: docs/plans/2026-10-21-a-sha-lookup-matches-a-build.md
bumps:
  skills:
    plot: patch
-->

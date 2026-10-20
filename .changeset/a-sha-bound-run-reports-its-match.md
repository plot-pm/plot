---
'plot': patch
---

`jenkins_sha_runs` reports the sha that matched a build, not the merge-base tip of the target branch a merge-before-build job also carries in `lastBuiltRevision`. `run-for-sha` and `runs-for-sha` now report the asked-for sha (or its full form from a short-hash match) instead of the other branch's tip.

<!--
plan: docs/plans/2026-10-20-a-sha-bound-run-reports-the.md
bumps:
  skills:
    plot: patch
-->

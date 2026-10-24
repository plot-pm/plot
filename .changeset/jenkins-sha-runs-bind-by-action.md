---
"plot": patch
---

Fixed `jenkins_sha_runs` binding a build's sha to the wrong branch when a build carried several `lastBuiltRevision` actions, because the branch names and shas were read into two flat lists and paired by position (#2231, #2244, #2180): a revision with zero or several branch names shifted every later pairing, so the asked branch could bind a merge-base sha instead of its own head sha. Each `lastBuiltRevision` action now produces one `{sha, branches}` record, and a build is searched record by record for the one naming the asked branch. The plain-job match key is now the asked branch rather than the job's last path segment (#2244, #2309), and `runs --limit N` filters `NOT_BUILT`/`ABORTED` builds before applying the limit rather than after (#2166, #2199), so the limit no longer undercounts.

<!--
plan: docs/plans/2026-10-24-jenkins-sha-lookups-in-plot-host.md
bumps:
  skills:
    plot: patch
-->

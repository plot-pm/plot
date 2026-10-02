---
'plot': patch
---

`plot-reconcile-scan.sh` section 23 asks `board/plot-issue-source.mjs` who lists this repository's issues instead of reading the `Tracker` key itself. It held a second copy of that rule — a first-token `awk` over `cfg "Tracker"` that refused `jira` and sent every other scheme to `plot-host.sh issue-list` — so a repository declaring `Tracker: linear` had its finished plans' `Issue: #N` compared against the git host's open issues and reported as clean. The entry is asked before any host call, with the `Tracker` value verbatim and the backend from `plot-host.sh backend`, which is the host the call would reach. Two new arms print the rule's own sentence and the count of plans that went unchecked: `nobody`, and an entry that could not be asked. Neither falls through to the host, `open_issues=` stays 0 on both, and the section stays out of `attention=`.

<!--
plan: docs/plans/2026-10-01-the-issue-ops-ask-who-answers.md
bumps:
  skills:
    plot: patch
-->

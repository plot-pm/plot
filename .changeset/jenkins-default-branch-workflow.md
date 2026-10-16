---
'plot': patch
'@plot-pm/domain': patch
---

`jenkins_sha_runs` now emits `workflow` as the Jenkins job path, fixing the default-branch red hold never firing on Jenkins: `WorkflowShaRun.workflow` is a required field `declaredRuns` filters on, and a Jenkins run with no `workflow` was filtered out of every `Default branch checks` list, folding to the same `unknown` as a quiet repository. A declared check name that still matches no run is now reported to `plot-fleetd`'s warn log by the new `unmatchedChecks`, so a config typo reads apart from "nothing has run yet".

<!--
plan: docs/plans/2026-10-16-the-agent-s-ci-wait-never.md
bumps:
  skills:
    plot: patch
-->

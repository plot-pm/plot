---
'plot': patch
'@plot-pm/domain': patch
---

`buildJenkins(...).runForSha` now maps Jenkins' `SUCCESS`/`FAILURE`/`ABORTED`/`NOT_BUILT` through `jenkinsConclusion` before returning a `ShaRun`, the same mapping `runsForSha` already applied — fixing a Jenkins fleet agent's CI wait never settling: the raw uppercase word read as unrecognised by `checksFromRuns`, so every build read as still running until the agent timed out at `Checks wait` with no `build passed`/`build failed` finding.

<!--
plan: docs/plans/2026-10-16-the-agent-s-ci-wait-never.md
bumps:
  skills:
    plot: patch
-->

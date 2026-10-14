---
'plot': patch
---

`plot-review [<pr>]` reviews one pull request and writes the `plot/review` commit status on the head SHA it reviewed. The reviewer agent runs in a detached worktree through the `AgentRun` port and writes a verdict file that `reviewVerdict` parses; a file with no `Findings:` line, two, or a non-integer count writes no status and exits 3. Zero HIGH findings writes `success`. One or more opens one follow-up issue, recorded per PR and head so a rerun opens none, and writes `failure` with the issue URL as `target_url`. The status goes through the new `Host.commitStatus()`, which calls `plot-host.sh commit-status`; `host-fixture.ts` records each write.

<!--
plan: docs/plans/2026-10-14-a-pr-cannot-merge-until-its.md
bumps:
  skills:
    plot: patch
-->

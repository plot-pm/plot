---
'plot': patch
---

`node skills/plot/scripts/board/plot-review.mjs [<pr>]` reviews one pull request and writes the `plot/review` commit status on the head SHA it reviewed. The reviewer agent runs read-only in a detached worktree through the `AgentRun` port's `command` runner: `claude -p` with only `Read`, `Grep` and `Glob`, `--permission-mode dontAsk`, `--strict-mcp-config` and `--setting-sources user`, never the `Verify command` fragment. `plot-review` writes the agent's final answer to the verdict file and parses it with `reviewVerdict`; an answer with no `Findings:` line, two, or a non-integer count writes no status and exits 3. `AgentRunResult` gains an optional `finalText`, filled by both runners. Zero HIGH findings writes `success`. One or more opens one follow-up issue, recorded per PR and head so a rerun opens none, and writes `failure` with the issue URL as `target_url`. The status goes through the new `Host.commitStatus()`, which calls `plot-host.sh commit-status`; `host-fixture.ts` records each write.

<!--
plan: docs/plans/2026-10-14-a-pr-cannot-merge-until-its.md
bumps:
  skills:
    plot: patch
-->

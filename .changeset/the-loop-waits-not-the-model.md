---
'plot': minor
'@plot-pm/board': minor
---

The JS worker loop runs an agent's prompt through the Claude Agent SDK when `Agent runner: sdk` is set. The loop, not the model, waits: a turn ends with a `next` hand-back, and on `next: checks` the loop runs the commands `plot-local-checks.mjs` prints and resumes the session with the result. Each SDK run disables background tasks, disallows `Monitor`, `ScheduleWakeup`, `CronCreate`, `TaskStop` and `ListAgents`, and refuses poll shapes through a `PreToolUse` hook. New config keys: `Agent runner`, `Agent models`, `Agent max turns` (150), `Slice max runs` (12) and `Agent context window` (200000). The prompt is read from `.plot/worker-prompt.md`, else from the shipped `templates/worker-prompt.md`. The `dispatch` and `continue` controllers refuse `Agent runner: sdk` under `Worker loop: shell`. An absent `Agent runner` reads `command`, so nothing changes until a project sets it.

<!--
plan: docs/plans/2026-10-05-fleet-agents-run-through-the-agent-sdk.md
bumps:
  skills:
    plot: minor
    plot-dispatch: minor
-->

---
'plot': patch
---

A fleet agent's `claude -p` prompt on the `command` runner now runs with `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` and `--disallowedTools Monitor,ScheduleWakeup,CronCreate,TaskStop,ListAgents`, the same background gate the SDK runner applies, read from one definition (`backgroundGateEnv`). The worker prompt template passes the list from `PLOT_BACKGROUND_DENY`; a project prompt file adds the one line to get the flag. Both worker loops read a turn whose output carries `Background tasks still running after …; terminating` or closes by waiting on a background task or a Monitor as `dropped`, not finished: the first drop on a slice writes a correction to `PLOT-CORRECTION.md` and resumes the session, and a second drop ends the slice `blocked` with a `PLOT-BLOCKED` marker (#1322).

<!--
bumps:
  skills:
    plot: patch
-->

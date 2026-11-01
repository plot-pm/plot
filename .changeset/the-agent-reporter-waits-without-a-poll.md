---
'plot': patch
---

The reporter beside a continued or restarted agent waits on a FIFO descriptor that only the agent subshell holds and starts no process while the agent runs, where it started a `sleep 0.05` about 5 times a second (49 in a 10 s sample under one restarted agent).

<!--
plan: docs/plans/2026-11-01-the-agent-reporter-starts-a-sleep.md
bumps:
  skills:
    plot-fleet: patch
-->

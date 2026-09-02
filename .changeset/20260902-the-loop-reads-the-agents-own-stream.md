---
'plot': minor
---

The WorkerMonitor reads the agent's transcript rather than its subtree's CPU.
`idle` meant a 0.4 s CPU sample of a process that spends most of its life
waiting on a model, so a false zero was the common reading rather than the rare
one — the rule ended eleven dispatched workers across two days, several holding
uncommitted work including new test files. A `claude -p` session appends a line
for every turn, tool call and tool result, so seconds since the newest line
reads whether the agent has done anything.

TWO READINGS, BECAUSE A TRANSCRIPT IS EQUALLY QUIET WHETHER AN AGENT WAITS ON A
MODEL OR ON ITS OWN TEST SUITE. Measured 2026-09-02 across 23 sessions, 7547
quiet stretches: p99 15.6 s, max 600.8 s — but 28 of the 37 stretches past 30 s
are an agent waiting on its own command, and the four longest are this repo's
gates (`gh pr checks --watch` 600.8 s, `pnpm run test:board` 600.3 s). Those
cluster at 600 because it is a timeout ceiling, not a distribution's tail, so a
single threshold would kill any project whose suite is slower. `PLOT_MONITOR_
QUIET_SECONDS` (900 s, 1.5x the measured max) is therefore a gate: past it the
monitor asks whether a child process is on a core, and a moving clock means the
agent's build is running. Where no transcript can be read the capability is
unavailable, nothing is published, and `Worker bound` ends the worker.

<!--
bumps:
  skills:
    plot: minor
-->

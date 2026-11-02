---
'plot': patch
---

The AgentMonitor's per-second check reads the pid file with the shell's `read` builtin and resolves its directory by parameter expansion, so each second starts one process (`sleep`) instead of three (`sleep`, `cat`, `tr`).

<!--
plan: docs/plans/2026-11-01-the-agent-reporter-starts-a-sleep.md
bumps:
  skills:
    plot: patch
-->

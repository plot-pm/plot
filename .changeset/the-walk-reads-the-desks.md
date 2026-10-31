---
'plot': patch
---

The plan walk reads who works each branch: `readDeskReadings` gathers each branch worktree's markers, pid and exit record, process state, index lock, unpushed commits and quiet seconds in one pass, and `Trees.locked` reads the index lock without spawning a process.

<!--
plan: docs/plans/2026-10-31-the-plan-walk-moves-into-the.md
bumps:
  skills:
    plot: patch
-->

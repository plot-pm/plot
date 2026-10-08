---
'@plot-pm/board': patch
---

`continueOnDesk` writes back the manifest a stopped free-waiting loop removes on `SIGTERM`, so the continued run keeps its registration and `resumeId`, and the previous AgentMonitor is stopped. Before the stop it reads the free-wait record again and refuses `loop-alive` when the loop has left it; a loop that does not exit within 10 s, or that the board cannot signal, is refused `loop-alive` with its pid named. A manifest stamp that fails after the start is logged to the desk's log.

<!--
plan: docs/plans/2026-10-08-a-blocked-agent-s-question-has.md
-->

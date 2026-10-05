---
'plot': patch
---

`agentLoop(readings)` in `packages/domain/src/workflows/agent-loop.ts` decides one pass of the agent loop from its readings and carries no state between passes; nothing calls it yet. It adds nine `Write` kinds, among them `desk-reset`, `declaration`, `loop-end` and `correction-count`, and the endings `blocked` and `checks-unanswered`, which `endingIsAttributable` admits for actor `agent`. Every ending that waits for a person also declares `blocked`, so `supervise` answers `needs-a-person`. `checksFromRuns` decides the loop's CI wait from the build connector's run for the pushed commit and the branch's remote tip: a tip that moved ends the wait (#1199), an unreadable tip keeps it going, and a bound of 0 starts no wait. Start retries raise the manifest's `attempts` and corrections raise `correctionAttempts`, and neither raises the other.

<!--
plan: docs/plans/2026-10-04-the-worker-loop-runs-in-js.md
-->

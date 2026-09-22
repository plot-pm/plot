---
'@plot-pm/board': patch
---

A registry row now reads the PROCESS where `plot-worker-state.sh` reads the desk. Measured 2026-09-22, three agents with live pids — 243, 6542, 27820 — all answered `finished` and every one was filtered out of WORKING, while the supervisor's own tick reported `idle=3 agents=3` for the same day. The shell is right and unchanged: its orphan arm fires when the WRAPPER is alive with no agent beneath it and hands a clear desk to `plot_worker_task_state`, which answers `finished` — the exact shape of a loop shell sleeping between slices. The row asks a different question, *is anyone sitting here now*, and `rowState` answers it by promoting `finished` plus a live `.plot-worker.pid` to `running`. Only `finished` is refined, because `waiting` and `stalled` are states the reaper depends on; the safety guard is `bashLiveness`'s hardcoded empty PR argument rather than `taskState`'s arm order, and it is commented at the change site, since a later caller passing a real PR fact would silently widen the refinement to a dirty or blocked desk. `drop.ts` shares the rule rather than inventing a guard. **This changes what the board STARTS, not only what it shows:** three newly visible agents raise `liveAgentCount` by three, so the fall-through budget narrows on this machine from *start up to 5* to *start up to 2* — the correct arithmetic, since three live agents genuinely occupy machine slots. Neither side of `corpus/agent-state.corpus.test.ts` moves: this refines one consumer's reading after the shell has answered.

<!--
plan: docs/plans/2026-09-22-the-board-asks-the-process-not-the-desk.md
-->

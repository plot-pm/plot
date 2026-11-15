---
'@plot-pm/board': patch
---

fleetd arms one watch per source of its trigger table (the refs, each desk's git state and files, the agent registry and `CLAUDE.md`) and keeps a pending set of the readings each change makes stale. Its heartbeat reports the real `watchesWanted`, `watchesArmed` and `lastEventAt`. A refs change also names `plans`. The scan still runs on every beat and clears the set.

<!--
plan: docs/plans/2026-11-10-triggers-replace-the-tick.md
-->

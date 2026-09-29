---
'@plot-pm/board': patch
---

The supervisor asks the git host about a branch at most once per tick. The supervisor world and the queue world now read `prMerged` through one per-tick memo, so a busy agent costs one host call per tick instead of two. A failed host call still reads as `unreachable` for supervision and `unknown` for the queue, and never as *not merged*.

<!--
plan: docs/plans/2026-09-29-a-tick-asks-the-host-once.md
-->

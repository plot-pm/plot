---
'@plot-pm/board': patch
---

The agent row field `briefWriting` is now `briefWriter`, so it no longer shares a name with the `briefWriting` helper. A running brief writer's note shows the age of its ask (`the brief writer has been working for 42s`). A run's `running` marker records its process start time, and a live pid that started later than the record reads as failed on Linux, where `/proc` gives the start time without a spawn.

<!--
plan: docs/plans/2026-10-10-the-channel-closes-its-review-findings.md
bumps:
  skills:
    plot-board: patch
-->

---
"plot": patch
---

Tracker status writes on Jira report `already` where the issue already holds the wanted status and `unreachable` (naming the current status and the available transitions) where the status exists in the workflow but no transition reaches it from the issue's current state. Both used to report as `no-target`, which also means "the tracker holds nowhere to put this status" — so a tracker behind the plan read the same as a harmless repeat.

<!--
plan: docs/plans/2026-10-24-tracker-issue-status-no-target-hides.md
bumps:
  skills:
    plot: patch
-->

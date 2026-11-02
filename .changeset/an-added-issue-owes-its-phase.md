---
'@plot-pm/board': patch
---

The state gate refuses a commit that adds an issue to the `Issue:` line of an Approved, Delivered or Released plan until `plot-plan-state.sh --only-issue <key>` has written the plan's phase to that issue and left the receipt `<plan path>#Issue <key>`.

<!--
plan: docs/plans/2026-11-01-an-issue-shows-its-plan-s.md
bumps:
  skills:
    plot: patch
-->

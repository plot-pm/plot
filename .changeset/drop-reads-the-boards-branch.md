---
"@plot-pm/board": patch
---

`POST /api/registry/drop` now resolves a `waiting` desk's branch the same way the board's registry does — from `git worktree list` for the desk's checked-out path, falling back to the manifest's own `branch` field only when no worktree is listed there — before asking whether the branch has merged. A desk still `waiting` on a `PLOT-BLOCKED` marker but whose assignment was already cleared has an empty manifest `branch`, which read as "not merged" regardless of the PR index, so the drop refused forever with "the agent is still running" even once the branch's PR had merged.

<!--
plan: docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md
bumps:
  skills: {}
-->

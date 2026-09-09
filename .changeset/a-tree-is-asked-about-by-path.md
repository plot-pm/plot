---
'@plot-pm/board': minor
---

A worktree carries whether its HEAD is detached, read from `git worktree list --porcelain`'s own `detached` line rather than inferred from an empty branch. A tree whose branch could not be read also has `''`, so the two facts are separate and both are recorded.

<!--
plan: docs/plans/2026-09-08-the-registry-sweeps-what-it-did-not-start.md
-->

---
'plot': patch
---

An empty branch no longer reads as merged. `gh pr list --head ""` applies no filter, so every PR in the repository matched: measured 2026-10-01 on `origin/main`, `pr_merged ""` exited 0 — merged — and `pr_merged_heads ""` printed 98 lines, the head of every merged PR here. The three lookups in `plot-pr-merged.sh` now refuse an empty branch before any `gh` call, answering `unaskable` rather than `none`, so no caller can remove a desk or delete a remote ref on it.

<!--
plan: docs/plans/2026-10-01-an-empty-branch-never-reads-as-merged.md
bumps:
  skills:
    plot: patch
-->

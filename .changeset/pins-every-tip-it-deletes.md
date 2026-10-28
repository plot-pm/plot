---
'plot': patch
---

`plot-reap --yes` now pins a local branch's tip before deleting it: `refs/plot/reaped/<branch>/<sha>` plus a row in `.plot/state/reaped.tsv`, at all three delete sites (a given-up worktree's branch, a squash-merged branch, an abandoned claim ref). A failed pin keeps the branch instead of losing the tip, and a `deleted` row prints its own restore command. A `--yes` run also prunes pinned refs whose row is older than 30 days.

<!--
plan: docs/plans/2026-10-28-plot-reap-yes-deletes-a-different.md
bumps:
  skills:
    plot: patch
-->

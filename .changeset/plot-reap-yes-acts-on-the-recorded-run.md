---
'@plot-pm/board': patch
---

`plot-reap --yes` now acts only on the set its own `--dry-run` recorded, never on a fresh full re-decision. `--dry-run` writes repository identity, the default branch name, its `origin/<default>` SHA, a UTC timestamp, and one row per worktree, branch, and claim it decided to act on, under the common git dir; `--yes` intersects that record with a fresh, narrow re-check per row and acts only on what survives both. On ewz-kus-portal (#2825), a host answer flipping between the two runs, a worktree's given-up delete freeing a branch the branch kind also deleted, or `origin/<default>` moving in between could make `--yes` delete a different set than the one an operator approved. A new `--yes --plan-slug <slug>` form needs no record, for the two unattended callers that already scope to one plan's branches.

<!--
plan: docs/plans/2026-10-28-plot-reap-yes-deletes-a-different.md
bumps:
-->

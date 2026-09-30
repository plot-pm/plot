---
'plot': minor
'@plot-pm/board': minor
---

The budget ledger rotates into two generations, and the supervisor and board logs rotate by size. `plot-budget.sh` writes `budget.tsv`, `budget.tsv.1` and a `budget.gen` counter under a `mkdir` lock, with stale-lock recovery and a record of each break; the reader reads both generations under the counter and reports what it read. `registryd` and the board open their own logs with `O_APPEND` and rotate at 10 MB, keeping three generations, because a writer that inherited its descriptor follows the inode across a rename. `plot-update-board.sh`'s cache outside a git repository moves from `/tmp` to `~/.plot/state/board-cache/`. The `BudgetRecord` port's `truncate()` is removed: it had no production caller and its write-aside lost 59 of 600 concurrent appends.

<!--
plan: docs/plans/2026-09-30-every-temp-directory-has-an-owner.md
bumps:
  skills:
    plot: minor
-->

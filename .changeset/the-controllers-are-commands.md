---
'plot': minor
---

The `dispatch` and `continue` controllers run with no board. `plot-dispatch-command.mjs <slug>` and `plot-continue-command.mjs <branch> <answer>` hold the refusals (`no-implement-command`, `implement-running`, `unknown-branch`, `no-worktree`) that `POST /api/dispatch` and `POST /api/continue` decided, and the routes call the same code. The controller gate refusal names the command first.

<!--
plan: docs/plans/2026-10-09-the-fleet-runs-without-the-board.md
bumps:
  skills:
    plot: minor
    plot-dispatch: minor
-->

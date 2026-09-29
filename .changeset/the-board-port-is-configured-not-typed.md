---
'plot': patch
---

The board's port is a `Board port` key in `## Plot Config` (read from `CLAUDE.md`, else `AGENTS.md`), so a second checkout on one machine keeps its port across restarts instead of needing `--port` on every `/plot-board` call. `/plot-board --start`, `--status` and `--stop` read the key when no `--port N` is given; `--port N` still wins, and an absent or empty key keeps 7777. A key that is not a number is refused rather than passed to the server. Plot's own `pnpm board` script reads the same key, so the restart command the board shows binds the declared port; `PORT=N pnpm board` still overrides it for one run.

<!--
plan: docs/plans/2026-09-29-the-board-port-is-configured-not-typed.md
bumps:
  skills:
    plot: patch
    plot-board: patch
-->

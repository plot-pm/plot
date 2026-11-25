---
'@plot-pm/board': patch
---

The board refuses every write endpoint on a non-loopback bind, and `PLOT_BOARD_ALLOW_REMOTE_WRITES=i-understand` no longer opens them (#3311). The refusal names the two routes that keep the board on loopback, `tailscale serve` with `PLOT_BOARD_ORIGINS` and an SSH tunnel, and says that the old variable no longer opens the gate where it is still set. The `plot-board` developer notes state what each route trusts and that `tailscale funnel` must not front the board.

<!--
plan: docs/plans/2026-11-23-the-board-refuses-unauthenticated-remote-writes.md
bumps:
  skills:
    plot-board: patch
-->

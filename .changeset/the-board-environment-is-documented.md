---
'plot': minor
---

The `plot-board` skill documents the board's address and access variables (`PORT`, `HOST`, `PLOT_BOARD_ORIGINS`, `PLOT_BOARD_ALLOW_REMOTE_WRITES`, `PLOT_BOARD_MOCK`, `PLOT_REPO_ROOT`, `PLOT_SCRIPTS_DIR`) with their defaults and effects. It states that the board listens on loopback by default and that every process on the machine reaches it, and it describes the route to another machine: a loopback bind behind a reverse proxy, with `PLOT_BOARD_ORIGINS` declaring the proxy's origin. It states that the write routes carry no authentication when `PLOT_BOARD_ALLOW_REMOTE_WRITES` is set, that a request with neither `Origin` nor `Sec-Fetch-Site` passes the same-origin check, and that release approval verifies its passkey against `localhost`. No behaviour changes.

<!--
bumps:
  skills:
    plot-board: minor
-->

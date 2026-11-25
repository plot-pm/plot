---
'plot': patch
---

`plot-fleetctl.sh --restart` reports the commit of the checkout that holds the loaded unit's bundle, read from the unit's own argv, and prints `unknown` for a bundle directory with no `.git` rather than a parent repository's HEAD. `--restart` and `--start` compare the loaded unit against the main checkout, so `--restart` from a linked worktree restarts the supervisor instead of refusing it as serving another checkout (#3367).

<!--
plan: docs/plans/2026-11-21-shell-scripts-refuse-a-second-mode-and-name-the-fetch.md
bumps:
  skills:
    plot: patch
-->

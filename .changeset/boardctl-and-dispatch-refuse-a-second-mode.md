---
'plot': patch
---

`plot-boardctl.sh` and `plot-dispatch.sh` refuse two different mode flags, such as `--start --stop`, with exit 1 and a message that names both; they no longer act on the last one. `plot-dispatch.sh` also refuses a second, different branch after `--stop`, `--restart` or `--release`. The same flag twice is still one mode (#3138).

<!--
plan: docs/plans/2026-11-21-shell-scripts-refuse-a-second-mode-and-name-the-fetch.md
bumps:
  skills:
    plot: patch
-->

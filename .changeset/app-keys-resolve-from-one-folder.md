---
'plot': minor
---

A `Review app`, `Writer app` or `Merger app` line may name only the App id; the key resolves from `PLOT_<ROLE>_APP_KEY`, then the path on the line, then `${XDG_CONFIG_HOME:-$HOME/.config}/plot/plot-<role>.<app id>.private-key.pem`.

<!--
plan: docs/plans/2026-11-06-app-keys-resolve-from-one-folder.md
bumps:
  skills:
    plot: minor
-->

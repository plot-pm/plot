---
'plot': patch
---

`plot-install-hooks.sh --verify` reads the gate path the installer registered rather than the script beside itself, so a gate registered where no script exists reports `unverified` instead of `verified`. Either reading finding the script still passes, and where neither does the report names both the plugin and the vendored reading rather than guessing which install it is.

<!--
plan: docs/plans/2026-09-25-a-plugin-install-finds-its-own-scripts.md
bumps:
  skills:
    plot: patch
-->

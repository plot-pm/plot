---
'plot': patch
---

The controller gate's escape now names a receipt script that exists in a repository that consumes Plot as a plugin. `plot-controller-gate.sh` printed `bash skills/plot/scripts/plot-state-receipt.sh --unowned-action …`, a path relative to the repository that exists only where Plot is vendored. The gate now prints the absolute path of the receipt script beside itself, quoted so that a path with a space stays one word when the line is copied. The gate's decision is unchanged (#980).

<!--
plan: docs/plans/2026-09-25-a-plugin-install-finds-its-own-scripts.md
bumps:
  skills:
    plot: patch
-->

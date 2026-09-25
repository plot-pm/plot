---
'plot': patch
---

`/plot-fleet --once` and `--start` now find the supervisor bundle in a repository that consumes Plot as a plugin. `plot-fleetctl.sh` resolves `plot-registryd.mjs` and Plot's `.nvmrc` from its own directory, not from the consumer's checkout, so the filled unit names the plugin's bundle. The node-version refusal now fires in a consumer repository, and `--start` refuses when Plot's pin cannot be read. A missing bundle reports a broken installation and offers `pnpm build:board` only for a development checkout. The new gate `scripts/check-bundle-resolution.sh` keeps shipped bundle paths resolved beside their script (#969).

<!--
plan: docs/plans/2026-09-24-fleet-control-finds-its-own-artifact.md
bumps:
  skills:
    plot-fleet: patch
-->

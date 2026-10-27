---
'@plot-pm/board': minor
---

A second board against the same repository and connector no longer polls the host for PRs on its own: when no `fleetd` heartbeat is live, exactly one board starts a standalone `plot-pr-reader.mjs` process (the same `fleetPrs` loop fleetd runs, driven by `startPulse` with no scan and no issue read), and every other board with a live reader to follow serves PR state from the reader lock's published state instead of its own fleet bridge. The reader exits once no heartbeat it can see is still live, or once a live `fleetd` heartbeat appears, so a restarted fleetd reclaims the role without a second reader lingering.

<!--
plan: docs/plans/2026-10-23-one-pr-reader-per-machine-and.md
bumps:
  skills:
    plot: patch
-->

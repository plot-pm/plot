---
'@plot-pm/board': patch
---

A new workspace package, `@plot-pm/fleet`, holds the supervisor tick, the agent loop, the fleet-size and prompt entries, and the 13 shared modules they import. `packages/board/build.mjs` calls the fleet's build and copies `plot-registryd.mjs`, `plot-worker-loop.mjs`, `plot-fleet-size.mjs` and `plot-prompt.mjs` to the same shipped paths. The supervisor and loop bundles no longer carry the board's contract schema (13 KB each), and their behaviour is unchanged. CI typechecks and tests the fleet, holds its loop coverage at 100%, and counts its spawn sites in the existing ratchets.

<!--
plan: docs/plans/2026-10-09-the-fleet-runs-without-the-board.md
bumps:
  skills:
    plot: patch
-->

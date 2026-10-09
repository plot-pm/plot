---
'@plot-pm/board': patch
---

A new workspace package, `@plot-pm/fleet`, now holds the supervisor tick, the agent loop and the fleet-size entry: `registryd-main.ts`, `registryd.ts`, `worker-loop.ts`, `fleet-size.ts`, `loop-writes.ts`, `prompt.ts` and the 13 shared modules they import moved from `packages/board/src` via `git mv`. `packages/board/build.mjs` now calls the fleet's own build function and copies its three output bundles to the same shipped paths, so `plot-registryd.mjs`, `plot-worker-loop.mjs` and `plot-fleet-size.mjs` are unchanged at runtime. `contract/schema.ts` re-exports the fleet's `AgentStateSchema`/`AgentIdentitySchema` so the board's 53 existing importers need no change.

<!--
plan: docs/plans/2026-10-09-the-fleet-runs-without-the-board.md
bumps:
  skills:
    plot: patch
-->

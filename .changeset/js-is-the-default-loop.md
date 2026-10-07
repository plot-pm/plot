---
'plot': patch
'@plot-pm/board': patch
---

The `Worker loop` config key's default moves from `shell` to `js`: the launcher, the board's `sdkLoopRefusal` gate, and `runnerChoice` now all read an absent key as `js`, and only an explicit `shell` still runs the shell loop body or refuses `Agent runner: sdk`. A new read-only script, `scripts/count-master-diagnosis.mjs`, reports a window's master-session diagnosis cost (matching Bash calls, their result characters, and a labelled token estimate) for the fleet measurement that gates this flip.

<!--
plan: docs/plans/2026-10-04-the-worker-loop-runs-in-js.md
bumps:
  skills:
    plot-dispatch: patch
-->

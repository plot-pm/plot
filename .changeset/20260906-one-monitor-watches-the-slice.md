---
'@plot-pm/board': patch
---

Two scripts every monitor needs now travel with the npm package. `build.mjs` vendors the helpers the board and the dispatcher shell out to, and each is listed in `packages/board/.gitignore` as build output and in `package.json`'s `files` so it reaches the tarball.

**`plot-monitor-subject.sh` was on none of those lists**, and all three monitors source it as a `$script_dir` sibling. It is *"the ONE answer to is this monitor's subject still there?"* — the thing that ends a monitor with its agent. Missing, `plot_monitor_wait` is undefined, the `while` driving every monitor's loop fails on its first call, and a monitor starts, takes one pass and exits. The worker then reads as monitored and is watched by nothing after its first second, which is the silent degradation the vendoring exists to prevent.

`plot-transcript-quiet.sh` was vendored by `build.mjs` but listed in neither the ignore file nor `files`, so it was committed as source rather than shipped as output.

<!--
plan: docs/plans/2026-09-05-a-process-is-started-by-its-own-command.md
bumps:
  skills:
    plot: patch
-->

---
'plot': minor
---

The worker loop's shell body is gone. `plot-worker-loop.sh` is now a pure launcher that `exec`s the JS entry point; the CI wait, the build-monitor pairing, and the idle-watch pass it used to run in bash are removed along with `plot-build-monitor.sh`, `plot-transcript-quiet.sh`, and the `manifest_count`/`raise_manifest_count` pair in `plot-agent-manifest.sh`. `plot-dispatch.sh` no longer starts a BuildMonitor or stamps `buildMonitorPid`. The `Worker loop` config key now only ever reads `js`.

<!--
plan: docs/plans/2026-10-04-the-worker-loop-runs-in-js.md
bumps:
  skills:
    plot-dispatch: minor
-->

---
'@plot-pm/board': patch
---

`continueOnDesk` refuses a continuation when `.plot-worker.pid`, the manifest `pid` or the manifest `wrapperPid` names a live process (409, reason `loop-alive`), fixing two loops running on one desk (#1294). The loop it starts is re-parented to pid 1 via a second shell level, so `plot-boardctl.sh --stop`'s `tree_pids` walk no longer finds and TERMs a continued agent (#1307).

<!--
plan: docs/plans/2026-10-07-a-controller-owns-what-it-starts.md
bumps:
  skills:
    plot: patch
-->

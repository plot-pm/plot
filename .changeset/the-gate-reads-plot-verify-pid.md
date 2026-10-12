---
'plot': minor
---

Verify mode and its daemon path: `/plot-deliver --verify <slug> [--at <sha>]` judges a Delivered plan per claim through `/plot-panel` and records the result; `Auto-verify` and `Verify command` let the fleet start the same run when `verifyStart` allows it, naming the reason when it does not; a failed run reads in Waiting on you with `/plot-deliver --verify <slug>`. The controller gate refuses a `CI suites` command under `PLOT_UNATTENDED=1` in a tree that holds `.plot-verify.pid`.

<!--
bumps:
  skills:
    plot-deliver: minor
-->

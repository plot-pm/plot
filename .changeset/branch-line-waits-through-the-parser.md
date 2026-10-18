---
'plot': patch
---

Two regression tests in `queue-reading.test.ts` pin the path from a markdown slice line carrying `builds:` then `waits:` through `plot-plan-meta.sh`, the plan-store adapter and `readQueue`: the waiting slice reads `waits`, and the slice after it reads `not-claimable`. Both pass on `origin/main`, so no rule changes; issue #1273 traces to a daemon started before the `waits:` reading shipped.

<!--
plan: docs/plans/2026-10-17-a-fresh-agent-after-a-wait.md
bumps:
  skills:
    plot: patch
-->

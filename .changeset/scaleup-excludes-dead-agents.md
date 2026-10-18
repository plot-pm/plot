---
'plot': patch
---

`scaleUp` no longer counts a dead agent — a manifest entry whose `state` reads `'none'` because its worker process has already ended — towards the fleet's running total, so a slice held `no-free-agent` starts a fresh agent instead of staying stuck behind a stale slot.

<!--
plan: docs/plans/2026-10-17-a-fresh-agent-after-a-wait.md
bumps:
  skills:
    plot: patch
-->

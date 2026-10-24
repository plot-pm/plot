---
"@plot-pm/board": patch
---

A `permission-denied` ending now writes `PLOT-BLOCKED.md` and a declaration itself, carrying the agent's own final text where the harness supplied one (#2545): an agent refused every write it tried had no channel left to report why, so three agents in ewz-kus-portal hit 13, 5 and 4 denials each with nothing left behind to read. `agentLoop` reads a new `finalText` reading, threaded from `AgentRun.finalText` through the fleet's run pipeline, and falls back to a fixed string only where the harness answered none.

<!--
plan: docs/plans/2026-10-24-an-agent-refused-every-write-ends.md
bumps:
  skills:
    plot: patch
-->

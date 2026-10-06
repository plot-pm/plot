---
'plot': patch
'@plot-pm/board': patch
---

Each SDK run appends one run line to the slice-spend record: the session's cumulative tokens and cost per model, its total cost, and the run's own turns. `readSpend` and `planSpend` sum each session's increases, so a resumed session counts once and a zeroed run adds nothing; the seal line covers only the sessions with no run line. Each `rate_limit_event` appends one budget entry under the `claude` connector. `Agent max spend` bounds one run and `Slice max spend` stops a slice before its next run with `spend-limit`; neither key has a default. A run that ends `turn-limit` gets one fresh session from the registry tick, shared with the `corrections-spent` allowance. The board's plan cost tooltip names the slices read from run lines, which include subagents and compaction.

<!--
plan: docs/plans/2026-10-05-fleet-agents-run-through-the-agent-sdk.md
bumps:
  skills:
    plot: patch
-->

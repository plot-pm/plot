---
'plot': patch
---

CI's `validate` job split its two slowest steps — Board integration tests and Helper contract tests — into their own parallel jobs, `board-integration` and `helper-contracts`, each required through a `needs:` edge from `validate`. Measured over the last 30 runs, the two steps held 74.7% of `validate`'s median wall time (1005s of 1345s); `validate`'s own remaining steps now measure a p95 of 376.65s, 25.1% of its 1500s cap, against the plan's 60% target.

<!--
plan: docs/plans/2026-10-19-validate-runs-at-86-of-its.md
bumps:
  skills:
    plot: patch
-->

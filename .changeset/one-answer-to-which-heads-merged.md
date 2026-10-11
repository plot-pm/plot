---
'plot': patch
---

`plot-pr-merged.sh` no longer defines `pr_merged_heads`; `plot-host.sh pr-merged-heads` is the one answer to "which heads merged". No script called the removed function — it duplicated an adapter already in use by `reap.ts`.

<!--
plan: docs/plans/2026-10-10-the-tests-and-gates-close-their-review-findings.md
bumps:
  skills:
    plot: patch
-->

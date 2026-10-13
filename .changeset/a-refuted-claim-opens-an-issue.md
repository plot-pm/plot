---
'plot': patch
---

The verify workflow opens one `ai-generated` issue per refuted claim that has none, keeps the numbers in `.plot/state/verify/<slug>.json` by claim text before the push, and ends each refuted line of `## Verification` in `#<number>` or `no issue: <reason>`.

<!--
plan: docs/plans/2026-10-12-the-fleet-verifies-what-it-delivered.md
bumps:
  skills:
    plot-deliver: patch
-->

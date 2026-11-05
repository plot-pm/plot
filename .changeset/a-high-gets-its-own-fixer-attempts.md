---
'plot': patch
---

The fixer counts HIGH and CI-red attempts against separate budgets of two, so two CI-red attempts no longer read a HIGH as exhausted and no longer let it merge on a ticket nobody tried to fix. A red head that an ended fixer pushed gets a fixer even where the desk reads `elsewhere` or `live`: the attempts record names the pushed head in an optional `pushedSha` field, at version 1. The re-status arm runs after the HIGH arm and obeys `Auto-review` and the review start budget.

<!--
plan: docs/plans/2026-11-03-open-plot-review-findings-from-the.md
-->

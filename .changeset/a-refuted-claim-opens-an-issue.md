---
'plot': patch
---

The verify workflow opens one `ai-generated` issue per refuted claim that has none. It finds an earlier issue by claim text in the plan's `## Verification` lines on the default branch and in `.plot/state/verify/<slug>.json`, marks a claim `pending` in that file before each open, and opens nothing for a claim whose issue may exist. Each refuted line ends in `#<number>`, a key such as `PROJ-12`, or `no issue: <reason>`.

<!--
plan: docs/plans/2026-10-12-the-fleet-verifies-what-it-delivered.md
-->

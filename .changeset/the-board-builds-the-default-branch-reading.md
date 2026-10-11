---
'@plot-pm/board': patch
---

A failing or pending check detail with an absent or empty `checksSha` reads "No commit is recorded for these checks." instead of ` @`. A unit test builds a board through `defaultBranchStore` and a PR record with `checksSha` and asserts both in the output, and the green-branch Agents-tab test waits on the board payload (#1476 M1, L1–L4).

<!--
plan: docs/plans/2026-10-10-the-channel-closes-its-review-findings.md
-->

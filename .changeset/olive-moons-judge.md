---
'@plot-pm/board': patch
---

A plan that is in the working tree, pushed to its own idea branch, and absent from the default branch renders as one card instead of two. The branch reader now skips a path the working-tree reader already supplied, joining the third plan source to the exclusion the other two already share.

<!--
plan: docs/plans/2026-09-11-the-board-answers-where-the-browser-asks.md
-->

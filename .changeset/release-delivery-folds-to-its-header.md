---
'@plot-pm/board': patch
---

The Delivery tab's Release delivery section folds to its header line. The whole header row is the toggle and the section starts open. Folded, the section shows its name, its scope and its counts: plans, slices delivered, at a gate and blocked. Each non-zero count is a link that opens the section and scrolls to the first plan row it counts; a count of 0 is text. The fold is one stored key, `release-delivery`, the same under the My sprint chip, and each plan row keeps its own fold.

<!--
plan: docs/plans/2026-11-19-release-delivery-folds-to-its-header.md
-->

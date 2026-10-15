---
'@plot-pm/board': patch
---

plot-review limits the inline diff to 98,304 UTF-8 bytes instead of 200,000 characters, so the review prompt stays under the 131,072-byte Linux limit on one exec argument.

<!--
plan: docs/plans/2026-10-15-follow-ups-from-the-review-of.md
bumps:
  skills:
    plot: patch
-->

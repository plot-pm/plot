---
'plot': patch
---

Adds a per-PR fixer attempts record to `@plot-pm/domain`, under `.plot/state/fixer-attempts/`: one JSON file per PR holding each attempt's head SHA, finding, and an in-flight mark written before the fixer starts. A missing or unreadable record reads as zero attempts for the budget check; an unreadable in-flight mark holds rather than reading as "none running".

<!--
plan: docs/plans/2026-10-29-a-high-finding-is-fixed-before.md
bumps:
  skills:
    plot: patch
-->

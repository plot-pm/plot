---
'plot': patch
---

Fixed three findings from issue #2479: `plot-config.sh get-raw` kept trailing prose after a backtick-quoted value (so a "Shipped code paths" regex written with an explanatory note fed `grep -E` a pattern that matched nothing, and section 22's guard read every plan as clean); `plot-plan-meta.sh`'s overlay mode let a bare `<!-- deferred -->` marker on a branch's list item blank out a deferral reason the heading had already recorded; and overlay mode could double a commit ref named on both a heading and its list item.

<!--
plan: docs/plans/2026-10-24-reconcile-scan-sections-7-20-24.md
bumps:
  skills:
    plot: patch
-->

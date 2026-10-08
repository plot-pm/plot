---
'@plot-pm/board': minor
---

A desk that ends `holding-work` after a prompt — uncommitted or unpushed work left behind, not a refused take-up — now gets the same one-fresh-session allowance `corrections-spent` and `turn-limit` already had, composed from `endingAction` and naming every file the desk still holds. All three readings now flow through one verdict function instead of two separate rules, and the registry tick's nothing-done pipeline reads the same shared fresh-session count the fresh-agent pipeline does, so a slice cannot earn two sessions by reaching the allowance through different endings.

<!--
plan: docs/plans/2026-10-07-every-loop-ending-has-a-supervisor-rule.md
bumps:
  skills:
    plot: patch
-->

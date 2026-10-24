---
"plot": patch
---

A heading-shape slice (`### Name (Branch: bug/x)`) no longer loses its list item's `→ #N` and annotations: `plot-plan-meta.sh` now reads a list item below the heading that claims the same branch, carrying its PR reference, `claimed:`, `deferred:`, `waits:`, `builds:` and `agent:` markers onto that branch, while a list item naming a different branch is reported — never silently dropped and never read as a second claim. The two lines merge: `waits:` values and `→ commit` refs from both lines are kept, an unreadable `waits:` value on either is reported, and a deferral on either line files every PR of that branch under `deferred_prs`. `plot-reconcile-scan.sh` gains a matching report-only section (24b) for the unattributable case. Five delivered plans in ewz-kus-portal were in this shape, and `/plot-release` step 5b refused them.

<!--
plan: docs/plans/2026-10-23-plot-plan-meta-a-branch-heading.md
bumps:
  skills:
    plot: patch
-->

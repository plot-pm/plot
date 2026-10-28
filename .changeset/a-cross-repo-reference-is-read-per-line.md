---
'plot': patch
---

A branch named identically in several repositories now has every one of its PRs checked for delivery, not only the first. `crossRepoReferences` returns every `(repo, number)` a branch's claim and heading lines name instead of the first, `deliverabilityOf` asks the host about each one, and `plot-impl-status.sh` keys its own lookups by `(repository, branch)` instead of branch name alone.

<!--
plan: docs/plans/2026-10-28-deliver-passes-a-plan-whose-slices.md
bumps:
  skills:
    plot: patch
-->

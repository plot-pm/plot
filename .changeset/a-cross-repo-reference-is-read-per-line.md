---
'plot': patch
---

A branch named identically in several repositories now has every one of its PRs checked for delivery, not only the first. `crossRepoReferences` returns every `(repo, number)` a branch's claim and heading lines name, `deliverabilityOf` asks the host about each one and its refusal names each unmerged `owner/repo#N`, and `plot-impl-status.sh` reads its `(reference, branch)` rows from the domain's `branchClaims` through the new `board/plot-slice-claims.mjs` bundle instead of its own sed/grep copy.

<!--
plan: docs/plans/2026-10-28-deliver-passes-a-plan-whose-slices.md
bumps:
  skills:
    plot: patch
-->

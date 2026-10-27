---
'plot': patch
---

`/plot-deliver` step 4 (`plot-impl-status.sh`) now names every unresolved, un-annotated branch to its one `pr-list --state merged --limit 500` call via repeated `--branch` arguments, instead of asking a nameless listing and matching heads locally — so a Bitbucket branch merged outside the newest page resolves correctly. The call count stays at one; on Bitbucket the request count inside it now scales with the number of unresolved branches, which the header comment states rather than the now-false "constant in branch count" claim it replaces. `plot-deliver`'s SKILL.md is updated to describe the by-name call shape.

<!--
plan: docs/plans/2026-10-23-read-merged-prs-from-the-merge.md
bumps:
  skills:
    plot-deliver: patch
-->

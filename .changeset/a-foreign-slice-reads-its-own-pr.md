---
'plot': patch
---

A slice in another repository reads `merged` when the PR its line names (`→ owner/repo#N`) is merged. The fleet scan asks `prState(N, { repo })` for each PR the line names, and the scan and `/plot-deliver` fold the answers through one rule, `crossRepoMergeState`: one unread PR reads `unknown`, one open PR reads `not-merged`, and both keep the branch `foreign`. Where a PR read fails, the scan report names it: `foreign — lives in ws/portal, not claimed here (PR ws/portal#31 read unknown)`. The snapshot protocol rises to 11.

<!--
plan: docs/plans/2026-11-28-a-foreign-slice-reads-its-own-pr.md
bumps:
  skills:
    plot: patch
-->

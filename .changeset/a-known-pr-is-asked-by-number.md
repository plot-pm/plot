---
'plot': patch
'@plot-pm/board': patch
---

The supervisor asks a known PR by number when the merged PR listing fails. Fixes #1140. On 2026-10-01 Bitbucket answered `bb pr list` with HTTP 429 for over 90 minutes, while `bb pr view <n>` answered in the same window. The supervisor read the failed listing as *nothing merged*, so every slice behind a merged one held `not-claimable` (#1094). It now reads the PR index for those branches: a merged row answers at no cost, and a branch with any row is asked with `plot-host.sh pr-state <n>`, at most five lookups per pass. Only the branches of each plan's first incomplete slice are asked, and a pass walks on to the next slice when they all merged. A lookup that does not answer reads `unknown` and keeps the slice held. A partial listing is no longer read as whole. The new domain rule `rules/known-pr.ts` chooses the source; the supervisor reads the index and never writes it.

<!--
bumps:
  skills:
    plot: patch
-->

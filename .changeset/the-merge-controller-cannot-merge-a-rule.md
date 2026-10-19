---
'plot': patch
'@plot-pm/domain': patch
---

`merge` now compares the PR head and the caller's sha with a new `sameCommit` rule — one is a prefix of the other, at least 7 hex characters, case-insensitive — instead of exact equality, so a Bitbucket repository's 12-character head no longer refuses every merge as `head-moved` against the caller's 40-character sha. `plot-ask.mjs merge <pr> <sha>` now accepts a sha of 7 to 40 hex characters, not only 40.

<!--
plan: docs/plans/2026-10-19-the-merge-controller-cannot-merge-a.md
bumps:
  skills:
    plot: patch
-->

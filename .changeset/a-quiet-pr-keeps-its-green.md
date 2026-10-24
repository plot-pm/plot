---
"@plot-pm/board": patch
---

Fixed a PR whose checks were green and unchanged for days reading as `unknown` on the board the moment it rotated out of the per-pass Jenkins lookup cap: a row whose `checksLookup` is `'skipped'` (past the cap) or `'broken'` (named, but the lookup broke before reaching it) now keeps the stored `checksSha` and `checks` colour when that `checksSha` equals the PR's current `headSha`, in the store and on the board, on a full read and on a delta. A row whose head moved, a row with no stored row, and a stored row with no `checksSha` still read the host's answer, which is `unknown` for such a row.

<!--
plan: docs/plans/2026-10-24-bitbucket-pr-rows-run-per-row.md
bumps:
  skills:
    plot: patch
-->

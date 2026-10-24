---
"@plot-pm/board": patch
---

Fixed a PR whose checks were green and unchanged for days reading as `unknown` on the board the moment it rotated out of the per-pass Jenkins lookup cap: `storeRow` now keeps a predecessor's `checksSha` and `checks` colour when the host's `checksLookup` for that row is `'skipped'` (past the cap) or `'broken'` (named, but the lookup broke before reaching it) and a predecessor with a `checksSha` exists. A row with no predecessor, or a predecessor carrying no `checksSha`, still reads whatever the host answered — the fallback only ever extends a stable reading, never fabricates one.

<!--
plan: docs/plans/2026-10-24-bitbucket-pr-rows-run-per-row.md
bumps:
  skills:
    plot: patch
-->

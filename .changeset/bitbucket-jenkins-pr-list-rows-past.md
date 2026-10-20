---
'plot': patch
---

`pr-list --rich` under a Jenkins CI scheme no longer reports a stale branch colour for a row the sha-lookup cap dropped. A row past `SHA_LOOKUPS_PER_PASS` now reads `checks: unknown` with an empty `checksSha`, on both the GitHub and Bitbucket arms; a row the cap named but whose Jenkins ask broke early still keeps its branch colour standing, and a row with no head sha is unaffected.

<!--
plan: docs/plans/2026-10-20-bitbucket-jenkins-pr-list-rows-past.md
bumps:
  skills:
    plot: patch
-->

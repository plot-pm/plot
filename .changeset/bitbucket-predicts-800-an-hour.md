---
'plot': patch
---

Plot predicts 800 Bitbucket requests an hour where no `Host rate limit` is declared, the ceiling that `bb` keeps. `Host rate limit` can lower that number. Neither `bb` nor fleetd sends a workspace or repository access token today, so a value above 800 has no effect yet.

<!--
plan: docs/plans/2026-11-20-bitbucket-shares-one-budget-with-bb.md
bumps:
  skills:
    plot: patch
-->

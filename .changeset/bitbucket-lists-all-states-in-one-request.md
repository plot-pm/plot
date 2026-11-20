---
'plot': patch
---

A Bitbucket pull request listing asks for every state in one paginated request with a `fields` filter. fleetd's full listing read for 53 tracked branches drops from 212 requests to one request per 50 pull requests in the repository, and a listing no longer asks once per branch.

<!--
plan: docs/plans/2026-11-20-bitbucket-shares-one-budget-with-bb.md
bumps:
  skills:
    plot: patch
-->

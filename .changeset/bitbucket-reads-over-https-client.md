---
'@plot-pm/board': patch
---

Adds the in-process Bitbucket HTTPS client: it reads `BB_EMAIL` and `BB_TOKEN` from the environment or `.env`, re-reads them once on a `401`, and charges every request to the `origin` workspace in the `bitbucket` ledger bucket `api`. No fleetd read uses it yet.

<!--
plan: docs/plans/2026-11-10-bitbucket-and-jira-read-in-process.md
-->

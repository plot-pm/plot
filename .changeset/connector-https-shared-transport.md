---
'@plot-pm/board': patch
---

The in-process GitHub client now sends its requests through `connector-https.ts`, one shared HTTPS module for proxies, the 30 s bound, host slots, ledger entries and the `429` mapping, and `rules/env-file.ts` reads credentials from `.env` the way `plot-host.sh` does.

<!--
plan: docs/plans/2026-11-10-bitbucket-and-jira-read-in-process.md
-->

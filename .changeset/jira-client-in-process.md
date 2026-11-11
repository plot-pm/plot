---
'plot': patch
---

Plot gains an in-process Jira HTTPS client, `jiraApi`, over the shared connector transport. It reads `JIRA_EMAIL` and `JIRA_API_TOKEN` from the environment or `.env`, refreshes them once on a `401`, reads a `429` as throttled, and charges each request to the ledger under a hashed account. No read uses it yet.

<!--
plan: docs/plans/2026-11-10-bitbucket-and-jira-read-in-process.md
-->

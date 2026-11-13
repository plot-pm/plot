---
'plot': minor
---

fleetd reads Jira issues in-process when `JIRA_EMAIL` and `JIRA_API_TOKEN` resolve from the environment or `.env`, and logs the tracker transport once at start. `PLOT_HOST_TRANSPORT=shell` forces the shell for the tracker and the git host alike. `/plot-fleet --status` prints the tracker transport.

<!--
plan: docs/plans/2026-11-10-bitbucket-and-jira-read-in-process.md
bumps:
  skills:
    plot-fleet: minor
-->

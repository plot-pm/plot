---
'plot': minor
---

fleetd and the board's PR reader now read Bitbucket pull requests in-process through the Bitbucket API client when `BB_TOKEN` resolves, and fall back to `plot-host.sh` when it does not or when `PLOT_HOST_TRANSPORT=shell` is set; with `CI: jenkins` the rich open read stays on `plot-host.sh pr-list --state open --rich`. The start log and `/plot-fleet --status` name the transport, its reason and the credential source.

<!--
plan: docs/plans/2026-11-10-bitbucket-and-jira-read-in-process.md
bumps:
  skills:
    plot-fleet: minor
-->

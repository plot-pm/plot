---
'plot': patch
---

On a GitHub repository with a token, fleetd and `plot-pr-reader.mjs` read pull requests, issues and the default branch's Actions runs in-process, and start no `plot-host.sh pr-list`, `issue-list` or `runs-for-sha` process for them. A Bitbucket repository, a GitHub repository with `CI: jenkins`, a machine with no token, and `PLOT_HOST_TRANSPORT=shell` keep the `plot-host.sh` reads. fleetd logs the transport, its reason and the token source at start, publishes them with its heartbeat, and `/plot-fleet --status` prints them.

<!--
plan: docs/plans/2026-11-09-github-reads-in-process.md
-->

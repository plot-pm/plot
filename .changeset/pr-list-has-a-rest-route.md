---
'plot': patch
---

`plot-host.sh pr-list` on GitHub answers the plain listing over REST (`GET repos/{owner}/{repo}/pulls`) when `PLOT_HOST_FORCE_REST=1` is set or the recorded GraphQL budget reads 0, and once more when GraphQL refuses the call for rate. The REST answer prints the same lines as the GraphQL one for `--state open|merged|closed|all|settled`, `--limit`, `--since`, `--repo` and a single `--branch`. `--rich`, the open half of `--rich-open` and the Jenkins arm stay on GraphQL, because REST's list carries no check rollup, no `mergeable` and no `reviewDecision`. On 2026-11-16 GraphQL read 0 while REST answered, and every `pr-list` caller failed with exit 5.

<!--
bumps:
  skills:
    plot: patch
-->

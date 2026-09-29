---
'plot': patch
---

A Bitbucket board narrows its PR refresh to what changed: `plot-host.sh pr-list --since` now asks the REST endpoint for `q=state="S" AND updated_on>="<since>"`, reads every page, and refuses a window that falls short of the server's `size`, instead of re-buying the full listing each pass.

<!--
plan: docs/plans/2026-09-28-a-cold-bitbucket-board-buys-the-whole-list.md
bumps:
  skills:
    plot: patch
-->

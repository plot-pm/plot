---
'plot': patch
---

A Bitbucket `pr-list` asks each state for one page of 50 through `bb api`, where `bb pr list` walked 10-row pages: `--state all` costs 3 requests instead of 8 on `quatico/quaweb-website`, with the same 67 rows.

<!--
plan: docs/plans/2026-09-28-a-state-sweep-is-one-request.md
bumps:
  skills:
    plot: patch
-->

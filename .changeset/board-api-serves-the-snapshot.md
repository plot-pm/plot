---
'@plot-pm/board': patch
---

While fleetd runs and a page is attached, `GET /api/board` renders from fleetd's snapshot and starts no `git` or `plot-plan-meta.sh` process for the plan estate; the ticket lanes link the snapshot's plans, and the reader's identity is read again only when `gh`'s `hosts.yml` or a git config file changes. Without fleetd the board reads for itself as before.

<!--
plan: docs/plans/2026-11-09-board-api-starts-nothing.md
-->

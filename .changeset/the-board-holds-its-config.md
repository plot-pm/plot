---
'@plot-pm/board': patch
---

`GET /api/board` read `## Plot Config` through four uncached paths and held `cachedCi`/`cachedPeople` for the process's whole life with no invalidation. A new `scriptsConfigCached` decorator holds a config answer per repository, keyed by a stat-based stamp over `CLAUDE.md`/`AGENTS.md` rather than a timer, and `board.ts`'s `scriptsFor`/`planStoreFor` and `server-info.ts`'s CI/People reads now share one cached `Scripts` per repository instead of each starting its own `plot-config.sh`.

<!--
plan: docs/plans/2026-11-01-the-board-starts-processes-on-the.md
-->

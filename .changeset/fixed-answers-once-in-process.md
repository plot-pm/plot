---
'plot': patch
---

The board and fleetd read the repository top level, the common git directory and the git host once per process. A later pass reads the held answer and starts no `git rev-parse` and no `plot-host.sh backend`. A failed read is asked again; `plot-host.sh`'s exit 4 is held.

<!--
plan: docs/plans/2026-11-08-fixed-answers-once.md
-->

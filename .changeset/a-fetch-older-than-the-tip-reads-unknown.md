---
'@plot-pm/board': patch
---

A branch whose last commit landed after the last PR fetch now reads `unknown`, not `abandoned` — a fetch that predates a branch's own tip cannot assert that no PR was ever opened for it. `infra/agents-md-mirrors-claude-md` read "commits, no PR ever opened" for about 8 minutes while #1239 was open, because a fetch at 10:00 was read as proof for a branch pushed at 10:04. Fixes #1240.

<!--
plan: docs/plans/2026-10-07-the-board-reads-a-pr-while-its-ci-runs.md
-->

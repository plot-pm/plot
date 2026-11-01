---
'plot': minor
---

A gate refuses a commit that adds or moves a sprint member line onto an open sprint while the plan's `Sprint:` field disagrees with the sprint the membership rule answers; it runs at commit time and, on pull requests only, in CI through `plot-sprint-member.mjs check`.

<!--
plan: docs/plans/2026-11-01-a-plan-that-joins-a-sprint.md
bumps:
  skills:
    plot-sprint: minor
-->

---
'plot': minor
'@plot-pm/board': minor
---

Adds `@plot-pm/domain`'s `planReference` rule and the board's `PlanReference` component: one place that resolves a plan's label (`<issue keys>: <slug>`), link and title from a Planning card, draft plan or `/api/fleet` entry, and renders it with a truncation-safe prefix/slug split. No existing call site reads from it yet — Rows and Panels wire it in and retire the duplicated `planNameLabel`/`planLink`/`planHref`/`rewritePlanLink(s)` helpers in a later wave of the same plan.

<!--
plan: docs/plans/2026-11-01-every-plan-reference-shows-its-issue.md
bumps:
  skills:
    plot: minor
-->

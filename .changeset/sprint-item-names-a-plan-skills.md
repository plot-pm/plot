---
'plot': patch
---

A sprint item's reference is a plan slug, and the template and `/plot-sprint` say so. An issue link in the lead — `- [ ] [#123](url) …` — reads as an item naming no plan rather than as a reference, which is what `plot-sprint-release.sh` has always reported; a struck reference is read through to the plan it names.

<!--
plan: docs/plans/2026-09-28-a-sprint-item-names-a-plan-or-says-it-has-none.md
bumps:
  skills:
    plot-sprint: patch
-->

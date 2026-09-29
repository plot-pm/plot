---
'@plot-pm/board': patch
---

The board's two sprint readers read a reference the way `plot-sprint-release.sh` does: a plan slug, struck through or not. `~~[slug]~~` read as no reference here while the shell resolved the slug, so the board counted a withdrawn Should as `open` where the release gate counted it `withdrawn` — one file, opposite answers, on the active sprint.

<!--
plan: docs/plans/2026-09-28-a-sprint-item-names-a-plan-or-says-it-has-none.md
-->

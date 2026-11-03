---
'@plot-pm/board': patch
---

`/api/fleet` carries `plans`, every plan at the default branch keyed by slug with its file and tracker issues, so `planIndexOf` can resolve a plan reference's prefix from the fleet payload alone, before `/api/board` answers.

<!--
plan: docs/plans/2026-11-01-every-plan-reference-shows-its-issue.md
-->

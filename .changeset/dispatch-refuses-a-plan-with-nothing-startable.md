---
'@plot-pm/board': patch
---

A dispatch or implement request for a plan whose only unsettled branches wait on an open prerequisite now refuses with `nothing-startable` (409) and names each held branch, instead of starting a brief run that times out.

<!--
plan: docs/plans/2026-11-02-a-slice-held-by-an-open.md
-->

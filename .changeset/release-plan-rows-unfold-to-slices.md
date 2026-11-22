---
'@plot-pm/board': minor
---

An opened Release delivery plan row lists each slice as a row of the Delivery shape: the slice name, its PR and branch as one tuple, a status pill from the new domain rule `slicePills`, and a ⋯ in the plan row's last column. The ⋯ holds Start work, which posts the line's own branch to `/api/dispatch`, and lists it disabled with its reason where the slice cannot start; a merged line keeps an empty cell of the same width.

<!--
plan: docs/plans/2026-11-20-delivery-rows-act-from-one-place.md
-->

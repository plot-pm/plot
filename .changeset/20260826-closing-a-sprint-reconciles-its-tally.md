---
"plot": patch
---

Closing a sprint reconciles checkboxes against plan phases.

`/plot-sprint close` now reconciles unchecked items whose plans have reached
`delivered` or `released` phase before flipping the sprint to Closed. Each
reconciled item is ticked and annotated with `<!-- reconciled: <phase> -->`.
Items with no resolvable plan (bare prose lines) are left alone and named in
the output.

The existing false-positive check now reads the plan's phase via
`plot-plan-meta.sh` rather than checking the directory (`active/` vs
`delivered/`). This respects `/plot-deliver`'s design, where the phase edit is
the transition and the index write is best-effort — a delivered plan whose
symlink move failed is no longer flagged as a false completion.

<!--
bumps:
  skills:
    plot-sprint: patch
-->

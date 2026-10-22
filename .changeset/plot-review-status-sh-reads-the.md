---
'plot': patch
---

`plot-review-status.sh` now filters to checklist lines (`- [ ]` / `- [x]`) before extracting a slug or annotation, so a sprint built from `skills/plot/templates/sprint.md` no longer reports its scope-change comment as a phantom item named `slug`; a plan-less checklist item that carries a `pr:` annotation now appears in the output, keyed by its own text, instead of being silently skipped.

<!--
plan: docs/plans/2026-10-22-plot-review-status-sh-reads-the.md
bumps:
  skills:
    plot: patch
-->

---
'plot': minor
---

`/plot-idea` asks "Does this plan carry significant design decisions?" in a new step 5, after the two ceremony questions. A yes writes the plan with `State: Design`, a `Design:` record and an empty `## Spec` section; the default writes `State: Draft` as before. An unattended run with no answer in its prompt writes `State: Draft`, names the skipped question and continues.

<!--
plan: docs/plans/2026-10-12-the-phases-are-declared.md
bumps:
  skills:
    plot-idea: minor
-->

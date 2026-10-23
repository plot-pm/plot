---
'@plot-pm/board': patch
---

plot-approve no longer discards a held host refusal behind a later domain refusal: a PR lookup that failed because the host refused (for example HTTP 429) now reports that refusal, with its reason, ahead of any domain check that only fired because the lookup was replaced with a placeholder reading.

<!--
plan: docs/plans/2026-10-23-plot-approve-reports-no-pr-found.md
bumps:
  skills:
    plot: patch
-->

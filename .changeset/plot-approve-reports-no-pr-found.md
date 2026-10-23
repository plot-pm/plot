---
'@plot-pm/board': patch
---

plot-approve no longer discards a held host refusal behind an unrelated domain pass: a PR lookup that failed because the host refused (for example HTTP 429) now reports that refusal, with its reason, instead of "no PR found" or "no plan found", once the plan clears every check the host's answer has nothing to do with. A refusal reached from the plan itself (its phase, review channel, or slice headings) keeps its existing precedence over a held host refusal.

<!--
plan: docs/plans/2026-10-23-plot-approve-reports-no-pr-found.md
bumps:
  skills:
    plot: patch
-->

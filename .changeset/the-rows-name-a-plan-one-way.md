---
'plot': patch
'@plot-pm/board': patch
---

Every row-level plan reference — a plan row, a slice's sole-plan link, a branch row, a draft-plan row, a verify run and the Delivery tab's plan-name link — now resolves its label, issue prefix and link through `@plot-pm/domain`'s `planReference`, fed by one plan index `AgentList` builds once from the board's cards and the fleet's draft plans. An idea branch the fleet scan has not yet read a plan from now links through its branch slug instead of falling back to the branch's git-host page, and a plan-name link opens the board's own modal rather than a new tab.

<!--
plan: docs/plans/2026-11-01-every-plan-reference-shows-its-issue.md
bumps:
  skills:
    plot: patch
-->

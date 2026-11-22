---
'@plot-pm/board': patch
---

Every Work items group shares one grid with the columns item, plan, status, by, age and the row menu. The status column shows whole-word pills from the domain's `workItemPills`: a CI or review gate pill names its outcome and links to its run, progress and waits read as words, a slice claimed on another machine shows a quiet pill, and an item outside the sprint shows a grey `no sprint` pill. The `kind` and `where` columns are gone; the branch is the second segment of the item's PR and branch tuple, ellipsised with its full name on hover. An empty group shows one "— none" row inside its grid.

<!--
plan: docs/plans/2026-11-20-delivery-rows-act-from-one-place.md
bumps:
  skills:
    plot: patch
-->

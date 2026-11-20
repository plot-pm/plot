---
'@plot-pm/board': patch
---

The lenient Mine mode keeps a row that is assigned to the reader or belongs to a plan of the reader. A branch row reads its PR author and its plan's assignee, author and approver; an agent reads its own arm and the plan of the row its branch joins; a ticket reads its assignees and each plan whose `Issue:` names it. A row is hidden only where no arm is the reader's and one names another person. The strict mode reads the row's own arm alone, as before.

<!--
plan: docs/plans/2026-11-20-delivery-rows-act-from-one-place.md
bumps:
  skills:
    plot: patch
-->

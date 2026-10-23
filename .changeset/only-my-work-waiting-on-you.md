---
"@plot-pm/board": patch
---

A Delivery row with no PR yet, whose plan names someone other than the reader as assignee, no longer shows under "Waiting on you" to every reader. The server now carries the plan's assignee, author and approver onto each branch row, including for a plan that exists only on its `idea/`, `feature/` or `bug/` branch, and the "Only my work" filter reads them when a row has no PR to resolve ownership from instead.

<!--
plan: docs/plans/2026-10-23-only-my-work-waiting-on-you.md
bumps:
  skills:
    plot: patch
-->

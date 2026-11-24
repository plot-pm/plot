---
'plot': minor
---

`plot-ask.mjs metrics [--weeks N]` prints one row per ISO week over the last N weeks (8 by default): merged pull requests, plans approved, delivered and released, the median days from `Approved:` to `Delivered:` and from `Design:` to `Approved:` for the plans delivered that week, and the approvals per approver. It reads the plan files on the default branch and the PR index, and calls no host; an index it cannot read prints `unread` in the merged column.

<!--
plan: docs/plans/2026-11-23-delivery-is-measured-from-the-plan-files.md
bumps:
  skills:
    plot: minor
-->

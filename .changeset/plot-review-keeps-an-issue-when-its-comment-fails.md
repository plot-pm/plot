---
"@plot-pm/board": patch
---

Fixed `plot-review` discarding a follow-up issue it found when the verdict comment on it failed: the run reported "the follow-up issue was not opened" and the issue record was removed, so the next run looked up or opened a duplicate. The found-issue arm now keeps the record and reports the issue as opened, the same way the recorded-id arm already did. An unaskable comment now also gets the `; verdict not commented` suffix on the status, targeting the PR rather than an issue holding a stale verdict, and a run that opens a brand-new issue now carries that run's marker in its status description, matching the marker already written into the issue body.

<!--
plan: docs/plans/2026-10-24-plot-review-loses-an-existing-issue.md
bumps:
  skills:
    plot: patch
-->

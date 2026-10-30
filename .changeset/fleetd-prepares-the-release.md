---
'plot': minor
---

fleetd prepares the release PR: it waits until every plan in the active sprint is Delivered, starts the `plot/review` of the release head through `startReview` once the CI workflow is green on it, and sends one notification when the head can be approved. A later head sends a second notification only when its changeset list differs from the last notified list, which is split into the sprint's plans and outside work; outside work never holds the release. The run log records the review starts and notifications as actions taken, and the release row shows the stage `waiting-scope`, `preparing`, `ready`, `merged`, `publishing`, `released` or `failed`.

<!--
plan: docs/plans/2026-10-29-the-release-waits-for-one-approval.md
bumps:
  skills:
    plot: minor
-->

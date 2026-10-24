---
'@plot-pm/board': patch
---

Fixed the offline ticket fallback showing a stale issue age above an unchanged row set: `offlineIssueRowsInto` now sets `entry.issueAt` only on the branch that also sets `entry.issues`, so a failed plan read during the fallback leaves both null instead of leaving the age behind (#2384). A second consecutive failed poll that lands on neither memory nor the index now clears `entry.issues` alongside `entry.issueAt`, rather than only the age (#2372). `issue-offline-fallback.ts` types the index's missing `at` as `string | null` instead of the sentinel `''`, and `ownSource` as `'tracker' | 'git-host'` instead of `string`.

<!--
plan: docs/plans/2026-10-24-board-status-banner-offline-tickets-and.md
bumps:
  skills:
    plot: patch
-->

---
'plot': patch
---

The issue pass now asks the tracker only for what changed since its last answered read, instead of re-reading the whole open, closed and inbox lists every pass. `Tracker.issueListChanged(since, limit)` is the new port read, implemented by every connector; `refreshIssueIndex` folds its rows into the held open and closed sets by `foldIssueRows`, moving a row that is now closed from `rows` into `closed.rows`. A full read remains the floor: `ISSUE_FULL_READ_PASSES` (20) and `ISSUE_FULL_READ_MS` (24h), named beside `ISSUE_REFRESH_MS` in `cadence.ts`, force one every N passes or once a day, measured from the last full read's own `fullReadAt` rather than wall-clock `now`. A held index with no `fullReadAt`, of another source or connector, or with `answer` other than `answered` reads whole, as every pass did before this change. A failed incremental read keeps the previous `rows`, `closed` and `at`, records `failedAt`/`reason`, and feeds `backoffUntil` through `hostReaction` the same way a failed closed read does. `requests` counts the incremental read's own pages. The inbox read is untouched and stays whole. Fixes a bug found while wiring this up: `tracker-shell.ts`'s `RawIssue`/`issueOf` silently dropped `updatedAt` from every shell-backed connector's JSON answer, which would have broken `foldIssueRows`' newer-wins ordering for GitHub and Jira.

<!--
plan: docs/plans/2026-10-16-the-ticket-index-updates-incrementally-and.md
bumps:
  skills:
    plot: patch
-->

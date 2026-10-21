---
'plot': patch
---

`plot-reconcile-scan.sh` §23 now checks whether a finished plan's issue is still open under `Tracker: jira` instead of refusing outright — the Jira key sitting in `oi_claims` already matches `issue-list`'s `number: .key` output through the section's existing fixed-string comparison, so no second parser was needed. A new advisory note fires when `Tracker: jira` is declared with no `Ticket prefixes`: without it, Jira's open-issue read is scoped to the calling account's own assigned tickets, so an issue open but assigned to someone else would otherwise read as closed here.

<!--
plan: docs/plans/2026-10-21-reconcile-23-checks-no-plan-under.md
-->

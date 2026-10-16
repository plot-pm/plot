---
'plot': patch
---

`IssueIndexRow` and `Issue` gain `updatedAt`, filled from `issueIndexRowOf` and folded by a new pure domain rule, `foldIssueRows`, which keeps the newer of two readings of the same key by `updatedAt`. Neither GitHub's nor Jira's `issue-list` connector fills the field yet — both would need to widen an explicit field-selection list (`gh issue list --json`, Jira's `fields=`) to get it, which this slice does not do; `ISSUE_INDEX_VERSION` stays 1, since the row schema's own `.strict()` parse failure already covers a pre-change reader meeting the new field.

<!--
plan: docs/plans/2026-10-16-the-ticket-index-updates-incrementally-and.md
bumps:
  skills:
    plot: patch
-->

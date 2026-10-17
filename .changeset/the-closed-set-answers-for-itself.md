---
'@plot-pm/fleet': patch
---

`refreshIssueIndex` no longer writes a closed, inbox or open read's `unsupported` answer onto `state.issueError` — only a genuine `failed` read does. A connector with no closed-issue listing (Bitbucket) or no person-scoped inbox read reported that structural absence as an ongoing error on every single pass; it is now a standing fact the index already carries under `closed.answer`/`answer`, never surfaced as a failure.

<!--
plan: docs/plans/2026-10-16-jira-inbox-and-issue-index.md
bumps:
  skills:
    plot: patch
-->

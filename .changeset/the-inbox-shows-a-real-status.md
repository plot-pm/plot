---
'@plot-pm/board': patch
---

The inbox shows a tracker issue's real status. `IssueRowSchema` carries `status` and `statusCategory`, `refreshIssues` projects both out of the `issue-list` lines it already reads, and `tupleFromIssue` renders the tracker's own word where it wrote the literal `open` for every issue. Measured on #849: four Jira tickets in *Internal Approving*, *In Progress* and *Reviewing* all read `open`. The literal's argument held for GitHub, whose `--state open` returns only open issues, and failed for Jira, whose default JQL asks for `resolution = EMPTY` — unresolved, which is wider than not started. The status cell renders the name because that is what a person reads; the category stays on the row as the stable vocabulary a board can group on. An empty status renders empty, the rule `prStatus` states for `unknown`, so a Bitbucket `WONTFIX` keeps the row and invents no category. Both fields default to `''` so a payload from a server predating them still parses.

<!--
plan: docs/plans/2026-09-09-every-issue-renders-as-open-issue.md
-->

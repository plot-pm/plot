---
'plot': minor
'@plot-pm/board': patch
---

A tracker issue carries its status. `issue-list` reports `status` and `statusCategory` from all three backends: Jira reads `.fields.status`, GitHub derives both from the `--state` the call already passes, and Bitbucket keeps the state badge it already parsed to find where the title starts. Two fields rather than one, because a workflow's own word may be localised and fragments across projects, while the three-value category is what a board can group on. `statusCategory` is empty where a tracker's vocabulary has no word for the state — a Bitbucket `WONTFIX` is terminal without being done, and calling it `Done` would file abandoned work beside finished work. The `Issue` entity's refusal of tracker state is amended rather than removed: `assignee`, `labels` and `priority` stay absent, asserted on both the request and the projection.

<!--
plan: docs/plans/2026-09-09-every-issue-renders-as-open-issue.md
bumps:
  skills:
    plot: minor
-->

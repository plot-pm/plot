---
'plot': patch
---

`plot-plan-meta.sh` reads an `Assignee:` line under `## Status` as well as under `## Approval`. Both plan templates offer `## Status`, and 44 of the 115 plans that write an assignee wrote it there, so the parser reported none for them. When a plan writes both sections, the `## Approval` value wins, and front matter still outranks both.

<!--
plan: docs/plans/2026-09-24-the-parser-reads-an-assignee-wherever-it-is.md
bumps:
  skills:
    plot: patch
-->

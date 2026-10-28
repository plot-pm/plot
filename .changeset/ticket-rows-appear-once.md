---
'@plot-pm/board': patch
---

`foldIssueRows` now dedups a repeated key inside its own `held` array through the existing `replaces` tie-break, closing the same gap for `foldChangedIssueRows` and `issueWriteThrough`, which both fold through it. `waitingTickets`'s two unmatched-reader fallback arms now dedup `candidates` the same way the matched arms already dedup `inbox` and `mine` — a repeated key reaching either path, from a held duplicate or an upstream paged read, rendered the same ticket row twice.

<!--
plan: docs/plans/2026-10-28-empty-jira-inbox-read-as-a.md
bumps:
  skills:
    plot: patch
-->

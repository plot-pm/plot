---
'plot': patch
---

The plan-state comment's body is now a pure domain renderer: `planIssueComment` moves out of the GitHub tracker adapter and into `rules/plan-issue-comment.ts`, taking slice progress and HIGH-ticket readings as part of `PlanStateWrite`. A write naming neither still renders byte-identical to the historic two-line body. Writes are now level-triggered against a last-written body hash and locked per issue, so two concurrent writers on an issue with no marked comment leave exactly one comment, and an identical second write makes no host call. A write on a machine with no ticket record of its own keeps the comment's existing ticket lines, read back once through the one sanctioned read-back `plot-host.sh issue-comment-read`.

<!--
plan: docs/plans/2026-10-29-tickets-follow-the-delivery-loop.md
-->

---
'plot': minor
---

An escalated question reaches the plan's issue. After fleetd's unblocker records an `escalated <reason>` row, fleetd posts one comment on the issue named by the plan's `Issue:` line through `Tracker.issueComment`, holding the question, the reason and the branch. The comment carries a marker keyed on the branch and the question's `askedAt`, so a repeat edits it in place. A plan with no `Issue:` line, an unaskable tracker and a failed tracker post nothing and log one line; fleetd makes one attempt per escalation and does not retry. The board's *Waiting on you* row for a desk whose question key holds an `escalated <reason>` row appends `· escalated: <reason>` to its note.

<!--
plan: docs/plans/2026-11-03-a-desk-s-design-question-waits.md
bumps:
  skills:
    plot: minor
-->

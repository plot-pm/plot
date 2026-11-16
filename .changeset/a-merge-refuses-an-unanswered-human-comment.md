---
'plot': minor
---

A merge through `plot-ask.mjs merge`, `release-approve` or fleetd's merge arm refuses `human-comment-open` while a PR holds a comment from a person that nobody has answered, and the refusal names the comment's author, time and first line. A conversation the host cannot read refuses `human-comment-unread`. fleetd skips a PR refused for either reason, asks the next candidate in the same pass, and asks the skipped PR again once its head or its row's `updatedAt` moves.

<!--
plan: docs/plans/2026-11-09-a-merge-ignores-an-unanswered-human.md
bumps:
  skills:
    plot: minor
-->

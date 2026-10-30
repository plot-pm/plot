---
'plot': patch
---

Adds an append-only answer record at `.plot/state/answers.tsv`, keyed by worktree and the question marker's modification time, so a desk's answered questions survive the marker's own deletion. `continueOnDesk` writes one `answered` row per successful continuation, shared by the board's `/api/continue` route and `plot-continue-command.mjs`. `continue` also gains a `question-moved` refusal: a caller that names the `askedAt` of the question it means to answer is refused, with no write to the desk, when the marker has since moved on to a different question.

<!--
plan: docs/plans/2026-10-29-the-fleet-answers-plot-blocked-questions.md
-->

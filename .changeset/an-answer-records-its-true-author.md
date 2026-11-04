---
'plot': patch
---

An answered question now records who actually answered it: `continueOnDesk` defaults a missing author to `unknown` rather than the misleading `unblocker`, `plot-continue-command.mjs` reads an optional `--who <handle>` before its branch/answer/question-key triple, and the board's `/api/continue` route reads `author` from the request body the same way it reads `questionKey`. A second `continue` call on a question that already holds an `answered` row still starts its agent, and appends no second row: the check runs under the continuation lock, at the append site, so two callers racing one question record one answer between them. The start is deliberately not refused — `continueOnDesk` never deletes `PLOT-BLOCKED`, and `askedAt` is that marker's modification time, so an agent that ends before deleting it would otherwise leave the desk waiting on a person with no route to continue it.

<!--
plan: docs/plans/2026-11-03-a-desk-s-design-question-waits.md
bumps:
  skills:
    plot: patch
-->

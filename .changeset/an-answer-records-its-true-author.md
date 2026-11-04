---
'plot': patch
---

An answered question now records who actually answered it: `continueOnDesk` defaults a missing author to `unknown` rather than the misleading `unblocker`, `plot-continue-command.mjs` reads an optional `--who <handle>` before its branch/answer/question-key triple, and the board's `/api/continue` route reads `author` from the request body the same way it reads `questionKey`. A second `continue` call on a question that already holds an `answered` row now refuses `already-answered` before the lock and before any write, so a race to answer the same question cannot append a second row.

<!--
plan: docs/plans/2026-11-03-a-desk-s-design-question-waits.md
bumps:
  skills:
    plot: patch
-->

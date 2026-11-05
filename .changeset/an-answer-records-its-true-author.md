---
'plot': patch
---

An answered question records who answered it, as the caller asserts it; nothing verifies the value. `continueOnDesk` records `unknown` for a call that names no author, not `unblocker`. `plot-continue-command.mjs` reads an optional `--who <handle>` before its branch/answer/question-key triple and refuses a missing, empty or blank handle with its usage error. The board's continue control sends `author: "board"`, and `/api/continue` records the request body's `author`, trimmed, or `board` when the body names none or a blank one. A `continue` on a question that already holds an `answered` row always starts its agent and appends no second row: the check runs under the continuation lock at the append site, so two callers racing one question record one answer between them, and a desk whose agent ended before it deleted `PLOT-BLOCKED` can still be continued.

<!--
plan: docs/plans/2026-11-03-a-desk-s-design-question-waits.md
bumps:
  skills:
    plot: patch
-->

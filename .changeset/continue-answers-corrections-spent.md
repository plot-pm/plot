---
'plot': patch
---

`plot-continue-command.mjs` and `POST /api/continue` deliver a person's answer to a desk whose loop ended `corrections-spent` or `turn-limit` and removed its manifest while a `PLOT-BLOCKED` marker stands. They refused `no-manifest` before. The written manifest resumes the session the `corrections-spent` ending now records as its `resumeId`, and it starts the slice's correction count at 0, so the continued run gets the full `Correction budget`. The supervisor's `start-fresh` verdict for both endings is unchanged.

<!--
bumps:
  skills:
    plot-dispatch: patch
-->

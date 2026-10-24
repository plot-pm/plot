---
"@plot-pm/board": patch
---

Delivery-tab chips are decided in `@plot-pm/domain`'s `chipRow` from the reader's current sprint selection. Each per-sprint chip reports a hidden count instead of a fixed `0`: the rows hidden with its sprint added to the selection, so every chip that is on shows the rows the screen hides. The `This sprint` chip counts against the current selection, and `rowInSprintSelection` no longer lets an empty selection admit a row in no Active sprint. The `Mine` chip reads the same host login `isMine` compares (#2476): a `gitEmail`-only reader or an email-shaped `hostUser` disables the chip, and each disabled reason names `hostUser` as the fix.

<!--
plan: docs/plans/2026-10-24-delivery-chips-and-waiting-on-you.md
bumps:
  skills:
    plot: patch
-->

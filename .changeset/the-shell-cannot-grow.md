---
'plot': patch
---

`scripts/check-shell-lines.sh` fails CI when the shell under `skills/` is longer than at its base: a pull request is compared with its merge base, a push to `main` with the event's `before` SHA as one range, and an exact revert of one commit on `main` passes. Measured 2026-10-03: shipped shell grew from 6,904 lines in `skills/plot/scripts/` before 2026-09-01 to 11,896 before 2026-09-15, and 76 of the 85 commits that touched it in 14 days made it longer. The gate stores no number and has no override. The `/plot-implement` brief template names it, so every brief after this one tells the implementer to offset new shell lines.

<!--
plan: docs/plans/2026-10-03-the-shell-shrinks-into-the-domain.md
bumps:
  skills:
    plot-implement: patch
-->

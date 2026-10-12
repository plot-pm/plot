---
'plot': patch
---

`plot-approve` requires a named person (`--who <handle>` in `People`) to approve a plan in the Design phase on every review channel, refuses it under `PLOT_UNATTENDED=1` with a Design-phase message, and `POST /api/approve` answers 409 for it. The state gate refuses a commit that removes or adds a `State:` line, or renames a plan file to a new path with the same slug, unless a receipt covers it (closes #1611).

<!--
plan: docs/plans/2026-10-12-design-work-proves-the-path.md
bumps:
  skills:
    plot-approve: patch
-->

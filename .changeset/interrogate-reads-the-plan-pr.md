---
'@plot-pm/board': patch
---

`POST /api/interrogate` no longer refuses every Draft plan under `Plan PRs: required`: it now asks the host for the slug's open `idea/<slug>` PR first, and runs the configured `Interrogate command` in a worktree of that PR's head so `/challenge-the-plan` reads the plan where it lives. A slug with no open plan PR still resolves from the main checkout, and a host that cannot answer refuses `plan-unreadable` naming the host's reason rather than falling back silently.

<!--
plan: docs/plans/2026-10-24-interrogate-cannot-reach-a-draft-plan.md
bumps:
  skills:
    plot: patch
-->

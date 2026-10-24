---
'@plot-pm/board': patch
---

`POST /api/interrogate` no longer refuses every Draft plan under `Plan PRs: required`: it now asks the host for the slug's open `idea/<slug>` PR first, and runs the configured `Interrogate command` in a detached worktree at `origin/idea/<slug>` so `/challenge-the-plan` reads the plan where it lives. The worktree has one path per slug and each run replaces it, so a second interrogation of the same plan works, and a branch checked out in another worktree neither refuses the run nor has its local branch reset. A slug with no open plan PR still resolves from the main checkout, and a host that cannot answer refuses `plan-unreadable` naming the host's reason rather than falling back silently.

<!--
plan: docs/plans/2026-10-24-interrogate-cannot-reach-a-draft-plan.md
bumps:
  skills:
    plot: patch
-->

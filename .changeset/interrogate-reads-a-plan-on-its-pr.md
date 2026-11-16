---
'@plot-pm/board': patch
---

`POST /api/interrogate` reads a Draft or Design plan from where it is: the head of the open plan PR that carries it (`idea/<slug>` or a batch PR), then the checkout, then the default branch as fetched. It finds the PR through the same `choosePlanPr` finder that approve and needs-design use, runs the panel in a detached worktree of that tip, and names the branch in the prompt and in `PLOT_INTERROGATE_BRANCH`, so `/challenge-the-plan` Phase 7b pushes the round to the plan PR branch. It refuses `pr-copies-differ` when two open PRs carry differing copies, and `pr-head-unheld` or `pr-carries-no-plan` as the finder does. Phase 7b no longer reads the `origin/HEAD` alias as a branch named `origin`.

<!--
bumps:
  skills:
    challenge-the-plan: patch
-->

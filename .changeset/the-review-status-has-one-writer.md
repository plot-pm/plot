---
'plot': patch
---

The master agent and every fleet desk can no longer write the `plot/review` commit status by hand. The controller gate refuses `plot-host.sh commit-status <sha> <state> plot/review` and a `gh api` call to a `statuses/<sha>` path with a `context` field of `plot/review` (`-f`, `-F`, `--field`, `--raw-field`, quoted or not), before it reads git and before it exempts a linked worktree. A role agent loses the `gh api` form too. The refusal names `plot-review.mjs` as the route.

<!--
plan: docs/plans/2026-11-03-pr-review-accepts-a-plot-review.md
bumps:
  skills:
    plot: patch
-->

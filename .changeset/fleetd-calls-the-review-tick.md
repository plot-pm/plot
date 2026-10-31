---
'plot': patch
---

fleetd starts `plot-review` on slice PRs. With `Auto-review: true`, each tick reads the PR index, the default-branch reading and the active sprint's scope, and starts `plot-review.mjs` on an open in-scope PR whose CI is green on its head and whose head has no `plot/review` status. The pass runs after the fixer pass and before the merge pass, starts at most one live review run, and starts nothing on a head whose review run lock a live process holds. A stop request skips the pass. The run log records each start and each refused start as a `review-start` line, and a repeated refusal once per PR, head and reason.

<!--
plan: docs/plans/2026-10-29-fleetd-reviews-every-slice-pr-in.md
bumps:
  skills:
    plot: patch
-->

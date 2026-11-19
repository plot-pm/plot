---
'plot': patch
---

`plot-loose-delete-command.mjs` and `POST /api/loose-delete` refuse `unaskable`, not `claimed`, for a claimed branch with a commit of work where the host cannot say whether a PR exists for it, or cannot say whether its closed PR merged. While GitHub refuses GraphQL, `plot-host.sh pr-merged` answers `unknown`. The `claimed` refusal sent such a branch to `release-claim`, which refuses a branch that holds work, so neither controller removed it. A claim-only branch still refuses `claimed`, and no unanswered reading lets a delete through.

<!--
bumps:
  skills:
    plot: patch
-->

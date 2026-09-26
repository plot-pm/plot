---
'plot': patch
---

`plot-approve.sh` tells a host that could not be asked apart from a host that answered *no PR*. It read the PR state with `2>/dev/null || pr_json=""`, so a rate-limited `pr-state` (exit 3) arrived at the refusal as `NONE` and prescribed pushing a branch the operator had already pushed — measured 2026-09-25 on Bitbucket, where PR 3636 was OPEN while `bb pr list` answered HTTP 429. A non-zero `pr-state` now stops the approval with the host's own stderr and names no repair to the branch; exit 4 stops with its own sentence. Neither stop merges, flips the phase or pushes. A genuine absence keeps its message unchanged.

<!--
plan: docs/plans/2026-09-25-a-throttled-host-is-not-a-missing-pr.md
bumps:
  skills:
    plot-approve: patch
-->

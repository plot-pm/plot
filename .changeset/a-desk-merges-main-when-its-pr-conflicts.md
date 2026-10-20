---
'plot': patch
---

A desk whose PR conflicts with the default branch no longer waits out the full `Checks wait` for a CI build GitHub never starts: `readPass` stops the wait's clock from starting on a `conflicting` reading, and `agentLoop` resumes the agent immediately with a merge-main-and-push correction, spending the same `Correction budget` a failed build spends, so a conflicting reading after that budget is spent ends the slice `corrections-spent` for a person instead of resuming forever. `plot-host.sh pr-state` now reports `mergeable` on GitHub (GraphQL, and REST by PR number), which is the reading this check needs.

<!--
plan: docs/plans/2026-10-19-a-desk-waits-for-ci-on.md
bumps:
  skills:
    plot: patch
-->

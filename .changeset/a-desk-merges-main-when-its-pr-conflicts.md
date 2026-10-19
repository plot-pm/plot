---
'plot': patch
---

A desk whose PR conflicts with the default branch no longer waits out the full `Checks wait` for a CI build GitHub never starts: `readPass` stops the wait's clock from starting on a `conflicting` reading, and `agentLoop` resumes the agent immediately with a merge-main-and-push correction, reusing `correctionBudget` so a second consecutive conflict ends the slice `corrections-spent` for a person instead of resuming forever.

<!--
plan: docs/plans/2026-10-19-a-desk-waits-for-ci-on.md
bumps:
  skills:
    plot: patch
-->

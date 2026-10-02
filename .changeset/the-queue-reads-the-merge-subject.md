---
'plot': patch
'@plot-pm/board': patch
---

The supervisor's queue reads a merge subject on the default branch as proof that a branch with no ref landed, so a merged slice on Bitbucket no longer holds every later slice of its plan while the host answers HTTP 429. Fixes #1139. The supervisor takes the readings the fleet scan takes, through three new refs-port operations: `planAdditions` for the commit that first added each plan file, `mergeSubjects` for the merges on `origin/<main>`, and `contains` for one ancestry test per matched pair. A subject proves a branch for its own plan only, and only when its merge is not contained in the commit that added that plan's file. A branch that carries a ref is never proven and keeps its own host question. Under an unreadable ref list, and when a walk fails, the queue applies no proof and reads as before. The next slice still needs one host answer about its own branch.

<!--
plan: docs/plans/2026-10-01-a-merge-subject-proves-a-landing-the-host-cannot.md
bumps:
  skills:
    plot: patch
-->

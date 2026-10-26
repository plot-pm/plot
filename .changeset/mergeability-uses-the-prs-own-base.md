---
"@plot-pm/board": patch
---

Fixed the worker loop's mergeability reading against three defects (#2122, #2167): `trees.mergeConflict` now merges against the PR's own `base` instead of the repository's default branch, the checks wait re-reads mergeability on every later pass so a PR that turns conflicting mid-wait is still caught, and `Checks wait: 0` checks mergeability before sealing the slice instead of after. `mergeConflictAtEntry` is removed in favour of a direct `mergeable === 'conflicting'` check, and the conflict-correction message now names its true source rather than carrying estate-specific wording.

<!--
plan: docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md
bumps:
  skills:
    plot: patch
-->

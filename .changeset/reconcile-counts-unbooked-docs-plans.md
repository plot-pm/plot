---
'plot': patch
---

Reconcile section 6 now reports a `docs` or `infra` plan that the newest release still owes and that reads Delivered. It asks `releaseUnbooked` through the new `plot-release-unbooked.mjs` bundle, counts the plan in `unreleased_delivered=`, prints a not-evaluated line where a read failed, and runs under `--offline`.

<!--
plan: docs/plans/2026-11-24-a-merged-release-books-its-plans.md
bumps:
  skills:
    plot-reconcile: patch
-->

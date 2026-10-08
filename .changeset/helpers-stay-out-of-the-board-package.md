---
'@plot-pm/board': patch
---

A board build removes a `plot-*.sh` helper copy at the package root that `vendoredScripts` no longer names, and `packages/board/.gitignore` ignores the vendored set with one pattern (#1344).

<!--
plan: docs/plans/2026-10-07-the-tests-and-sweeps-leave-no-trace.md
-->

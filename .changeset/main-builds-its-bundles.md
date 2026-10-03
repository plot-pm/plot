---
'plot': patch
---

A workflow builds the generated board bundles after each push to `main` and pushes them as the `plot-build` GitHub App, so a pull request no longer has to carry them. `scripts/main-bundles.sh` holds the decisions: a fresh tree pushes nothing, a stale tree commits only the generated paths, and a refused push is reported without a retry. On `main`, CI warns about a stale build instead of failing, and the release job refuses to tag one. The `version` script stops building the bundles.

<!--
plan: docs/plans/2026-10-02-a-branch-carries-no-built-bundle.md
bumps:
  skills:
    plot: patch
-->

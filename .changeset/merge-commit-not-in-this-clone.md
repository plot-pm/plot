---
'plot': patch
---

`plot-reconcile` no longer advises `git fetch --tags origin` for a Bitbucket-sourced merge commit a fetch cannot bring — Bitbucket exposes no ref for a squash/merge commit once its source branch is deleted, so the finding now names that instead. A GitHub-sourced miss, or one caused by `--no-fetch` or a shallow clone, still gets the fetch advice.

<!--
plan: docs/plans/2026-10-20-merge-commit-not-in-this-clone.md
bumps:
  skills:
    plot-reconcile: patch
-->

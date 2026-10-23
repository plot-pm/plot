---
'plot': patch
---

A newly dispatched fleet desk is named `desk-<id>` instead of `free-<id>`, matching the vocabulary already used by `rules/reapable.ts`, `plot-desk-dirt.sh` and reconcile section 21. Existing `free-<id>` desks are untouched and still recognised by their `.plot-worker.pid` file.

<!--
plan: docs/plans/2026-10-23-name-fleet-desks-desk-id-instead.md
bumps:
  skills:
    plot-dispatch: patch
-->

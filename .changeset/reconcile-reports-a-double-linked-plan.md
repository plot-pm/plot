---
'plot': patch
---

`plot-reconcile-scan.sh` section 1 reports a plan symlinked in both `active/` and `delivered/`, naming the phase and the stale link's removal command — previously no arm matched a plan with both links present, so the scan printed nothing for it.

<!--
plan: docs/plans/2026-10-21-reconcile-does-not-report-a-plan.md
bumps:
  skills:
    plot-reconcile: patch
-->

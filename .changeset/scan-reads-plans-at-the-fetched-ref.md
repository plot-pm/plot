---
'plot': patch
---

The reconcile scan's delivery-landed gate (section 2, `merged_not_delivered`) now reads a plan's phase from `origin/$MAIN` via `git show` instead of the working tree, fixing #1340. `plot-deliver.sh` pushes a plan's `Delivered:` record without fast-forwarding the local checkout, so a scan run immediately after a delivery used to glob the pre-delivery copy of the plan file and falsely report `merged_not_delivered=1` for a plan already Delivered on the pushed ref. A plan still on a feature branch, never pushed to `origin/$MAIN`, is unaffected — the ref read falls back to the working tree's phase when the ref has no copy of the file.

<!--
plan: docs/plans/2026-10-17-delivery-reads-the-delivered-plan-and.md
bumps:
  skills:
    plot: patch
-->

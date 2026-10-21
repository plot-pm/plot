---
"plot": patch
---

`/plot-reconcile` section 23 no longer tells a Released plan to release itself: for a Released plan whose issue is still open, it names why — no `Tracker released status` configured, or the issue sits in a tracker status Plot does not own — and a Delivered plan keeps today's hint. The section now asks `plot-host.sh issue-view` once per distinct issue key a finished plan names, replacing a 200-row `issue-list` window that read an issue past row 200 as closed (measured on ewz-kus-portal, issue #2283).

<!--
plan: docs/plans/2026-10-21-reconcile-23-tells-a-released-plan.md
bumps:
  skills:
    plot: patch
-->

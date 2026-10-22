---
'plot': patch
---

Section 23 of the reconcile scan no longer tells a Delivered plan on a Jira tracker with no `Tracker released status` declared to "release the plan" — that release writes nothing the tracker reads as closed. It now names the configuration gap instead, the same wording a Released plan already got. A declared status, or a GitHub tracker, keeps today's release hint.

<!--
plan: docs/plans/2026-10-22-reconcile-23-tells-a-delivered-plan.md
bumps:
  skills:
    plot-reconcile: patch
-->

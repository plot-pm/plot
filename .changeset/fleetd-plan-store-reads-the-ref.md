---
'plot': patch
---

fleetd's queue, supervisor and index monitor read plans from `origin/<default>` instead of the daemon's own checkout: a plan approved on the host moved only the ref, and nothing else fast-forwards a daemon's working tree, so an approval could stay invisible for as long as the checkout sat stale (measured 2026-10-26: 17 minutes). The new ref-backed `PlanStore` answers an empty list rather than the working tree on an unresolvable or unreadable ref, so a stale checkout can never surface a plan the ref doesn't have.

<!--
plan: docs/plans/2026-10-26-implement-leaves-its-brief-and-plan.md
-->

---
'@plot-pm/board': patch
---

An issue's plan lane now reads every plan from `origin/<default>` rather than the working tree, so a stale local checkout no longer hides a plan that already named the issue after merging. `planMetasAtDefault` replaces `planMetasOf` as the one source `ticketPlansOf`, `ticketLaneData`, and `/api/idea`'s referenced-issue check read from, caches on the resolved default-branch oid, and falls back to the working tree only where no remote exists.

<!--
plan: docs/plans/2026-11-01-an-issue-shows-its-plan-s.md
-->

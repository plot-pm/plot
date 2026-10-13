---
'@plot-pm/board': minor
---

The Agents tab now renders the auto-verify fleet's own runs — a plan, a sentence, no branch — alongside branch rows: a failed or stopped verify run with its restart command in *Waiting on you*, a running verify in *Working*, and a halted-fleet sentence shown once rather than once per row. `/api/fleet`'s `verification` field has carried this since PR #1635; closes #1640 (H7).

<!--
plan: docs/plans/2026-10-12-the-board-has-three-tabs.md
-->

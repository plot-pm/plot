---
'plot': patch
---

A slice whose PR merged no longer shows "CI running" on its board row or its plan row. `fleet.ts`'s `prStates` now asks a new domain rule, `prChecksSuppressedByMerge`, before reading a PR's stored `checks`, closing the gap where a PR that merged while its last CI run was still queued kept showing a stale `pending` forever.

<!--
plan: docs/plans/2026-10-09-a-merged-pr-s-checks-freeze.md
-->

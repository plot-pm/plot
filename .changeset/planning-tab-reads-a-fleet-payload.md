---
'@plot-pm/board': patch
---

The Planning tab's plan-source age now comes from `/api/board`'s own `planRefAgeSeconds`, ticked client-side and frozen with ` (frozen)` the moment `/api/board` goes unreachable, instead of reading the Delivery tab's `/api/fleet` payload — which stayed `null` until a reader first opened Delivery, then never refreshed again. The sprint modal's "open this plan" link now uses a new `sprintItemDestination` rule that checks the board's own card set, replacing a fallback that could point at a stale fleet-derived path for a member the board no longer carries.

While fixing this, `SprintModal`'s MoSCoW grouping was found comparing a member's lowercase `tier` (`must`/`should`/`could`/`deferred`) against capitalized group keys (`Must`/`Should`/`Could`/`Wont`), so `groupByTier` silently rendered zero members for every schema-valid sprint on `main`. Fixed with an explicit `TIER_LABELS` lookup.

<!--
plan: docs/plans/2026-10-29-planning-tab-reads-a-fleet-payload.md
bumps:
-->

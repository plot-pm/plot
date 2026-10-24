---
"@plot-pm/board": patch
---

Fixed two board-client findings from issue #2477 (#2088, #2113): the 12 s `/api/board` fetch bound could not by itself stop two requests from overlapping under the 4 s starting-poll or a channel-triggered refetch, and a remembered plan-link click sat out the full 30 s deadline even once the board was already known unreachable. `load()` now skips starting a second request while one is outstanding, and a pending click resolves to `/plan/<file>` as soon as the board's own unreachable signal is set. Also removed the three `card as Card` casts by narrowing on `card` directly before calling `planLinkClick`, and wired the sprint modal's `onOpenPlan` to fall back to `/plan/<file>` via `planFileFromFleet` when the board holds no card for the slug.

<!--
plan: docs/plans/2026-10-24-board-status-banner-offline-tickets-and.md
bumps:
  skills: {}
-->

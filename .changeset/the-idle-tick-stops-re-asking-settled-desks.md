---
'plot': patch
---

fleetd's tick asks the git host less while the fleet is idle. A dead desk whose ending is `bound`, `unreadable` or `quiet` no longer costs a `pr-state` call on every tick once its PR merged, its desk carries a `PLOT-BLOCKED` marker or the ending closed a free wait, because the ending rule decides those desks without the open-PR or commit reading (`boundWorkDecides`). The idle pass keeps each worktree branch's merge reading across ticks and asks again after 10 minutes for a `not-merged` or unanswered reading (`idleMergeReusable`); a `merged` reading is never asked again. Measured 2026-11-19 on an idle fleet: 9 `pr-state` and 10 to 11 `pr-merged` calls per tick, about 20 GraphQL requests, at 72 ticks an hour.

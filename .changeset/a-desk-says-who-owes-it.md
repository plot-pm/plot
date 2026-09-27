---
'@plot-pm/board': patch
---

A desk with no live worker says why. The supervisor computes a `SupervisionCause` for every desk each tick and, before this, printed it to stdout and discarded it: measured 2026-09-27, `/api/fleet` was 31,240 bytes over 22 rows with no cause field anywhere, so a desk deferred on `no-headroom`, a desk the fleet was restarting after `no-progress`, and a desk out of correction attempts all looked identical. `plot-registryd` now writes a per-tick report under the common git dir's `.plot/state/`, replaced atomically, and the board reads it on refresh and carries the cause onto the row as `AgentRow.supervisionCause`. The row's status is qualified by the cause — `waiting for room`, `restarting`, `out of attempts` — as a secondary word beside the existing status, the shape `worker_activity` already uses. `owesAPerson` states which of the nine causes leave nothing automatic, as a total record so a tenth fails the build; `no-progress` is not one of them, because it is what the fleet restarts on and `budget-spent` is the transition to a person. The cause is forwarded and never re-derived: the board calls neither `supervise()` nor `tick()`, since doing so would double the per-agent host call the tick already makes. A missing report, an unparseable one, a desk the report does not name, a desk on another machine, and a report older than `FLEET_TICK_STALE_SECONDS` all read `null` — the tick did not judge this desk — and null is never `worker-alive`. No row changes section: placement still reads `AgentState` through `isBrokenState`, which is untouched.

<!--
plan: docs/plans/2026-09-27-a-desk-says-who-owes-it.md
-->

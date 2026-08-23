# Worker notes — an-eligible-wave-starts-itself (wave: Served)

Design decisions settled while implementing wave 3 of
`approval-hands-the-work-to-agents`. Not a plan file (no `Phase:` field) — a
decision log, the same kind `docs/plans/` already holds.

## What this wave does

While `fleetControls.autoDispatch` is on, eligible waves of approved plans
dispatch with no click, wrapping `plot-dispatch.sh` and honouring its caps.

## Where the trigger lives — NOT a route

Auto-dispatch rides the scan timer inside `fleet.ts` `refresh()`, called right
after `maybeRepair`. It is the SECOND "one automatic write" of the same kind:

- On the scan's clock, inside its success path — a dispatch may only start from
  a pulse that actually landed (stale refs otherwise).
- Off the request path entirely: it never becomes an `/api/*` route, so it does
  not join `write-gate.test.mjs`'s `WRITE_ROUTES`. The brief flagged that list
  as a trap "when a new write route" is added; this deliberately adds none, the
  same reasoning `maybeRepair` records ("there is nothing to reach").

## The cross-pulse cap — the hard part

`--max N` bounds ONE invocation. Two pulses each passing N reach 2N. So the
budget each pulse is `parallelAgents − live`, where `live` counts:

1. Registry entries in a LIVE state (`running` or `waiting`) — a `waiting`
   worker still occupies a slot (finished-row-guard memory: waiting IS a live
   worker), and
2. An in-process `inFlight` set of branches this board dispatched but the
   registry has not yet caught up to.

(2) closes the detached-manifest race: `plot-dispatch.sh` is spawned detached,
so a branch dispatched this pulse may show neither a manifest nor a claim ref on
the very next pulse — counting only the registry would let the board dispatch it
again and reach 2N. `inFlight` entries are pruned once the branch appears as a
live registry entry OR as `claimed`/`merged`/gone in the pulse.

## Never kill; lowering only withholds the next dispatch

The control governs STARTING, not stopping. Lowering `parallelAgents` or turning
the switch off shrinks/zeros the budget for the NEXT pulse and touches no running
worker. A negative budget clamps to 0.

## Eligibility, from the pulse only

- Only plans whose `phase === 'approved'`.
- Only waves whose `verdict === 'eligible'` (the scan's own arithmetic).
- Per plan, `--max <remaining budget>`; the script refuses claimed branches,
  abandoned desks, and Draft/blocked itself — we do not re-implement any of it.

## Scope

New file `packages/board/src/server/auto-dispatch.ts` + its wiring in
`fleet.ts` + tests. `plot-dispatch.sh`, the switch, and the stepper untouched.

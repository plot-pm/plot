# First tick after --start counts agents the start already launched

> The supervisor's first tick after `/plot-fleet --start N` counts only registered agents, reads 0, and starts extra agents beyond the N the operator asked for.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** bugfix-2-28-2
- **Issue:** #2409
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2425 merged
- **Started:** 2026-10-23, Claude, `bug/first-tick-after-start-counts-agents`
- **Delivered:** 2026-10-23
- **Released:** 2026-10-28, v2.29.0

## Changelog

- Fix: the first supervisor tick after `/plot-fleet --start N` no longer starts agents beyond N when the agents `--start` launched have not registered yet.

<!-- Board impact: none expected. The fix reads agent counts in the fleet supervisor; no plan format, template or board payload field changes. -->

## Motivation

Issue #2409, observed in ewz-kus-portal (Plot 2.28.0, Bitbucket) on 2026-10-23. `/plot-fleet --start 3` launched three free agents. The first supervisor tick ran before they registered under `.plot/agents/`, counted `agents=0`, held the queue's slice as `no-free-agent=2`, and started two more:

    plot-fleetd tick agents=0 left=0 … no-free-agent=2 … started=2 … cost=155344ms
      started 2 free agent(s) for the queue

The next tick read `agents=5 left=5 … handed=2 … idle=3`. Five agents ran where the operator asked for three. The registry files show the timing: three at 14:35–14:36 from `--start`, two at 14:38 from the tick. `plot-dispatch` owns the count and its default, and the supervisor overrode it on a race.

The tick cost 155344 ms, so the registration window is wide enough to hit on a slow machine.

## Design

### Approach

The scaling decision is in `packages/domain/src/workflows/assign.ts` (around line 237). It computes `running` from the registered agents plus `verifying` and `specRunning`, and passes `requested: waiting === 0 ? running : fleet.size` to `scaleFleet`. An agent that `--start` launched and that has no registry file yet is in none of those counts.

The issue names two fixes:

1. `--start` waits until the agents it started are registered before it returns, so the first tick sees them.
2. The tick counts launched-but-unregistered agents, whose pids are known, as running.

Fix 2 is the recommended direction: it also covers a supervisor restart and a slow registration that fix 1 only narrows, and it keeps the count a function of recorded state. Fix 1 alone leaves a window whenever the wait times out. The slice should confirm where the launched pids are recorded (`.plot/state/fleet-start.done` holds only a completion time) and what the tick can read without a process spawn.

A launched agent whose process died before it registered must not count forever. The count needs a bound, for example the pid is alive or the launch is younger than `Worker bound`.

### Open Questions

- [ ] Where does `--start` record the pids it launched, and does the tick already read that file?
- [ ] Fix 1, fix 2, or both? Fix 2 alone leaves `--start` returning before agents register; a caller that reads `/plot-fleet --status` right after sees fewer agents than it asked for.
- [ ] What ends the count of an unregistered launch: a dead pid, an age bound, or both?

## Slices

### Count launched agents

- `bug/first-tick-after-start-counts-agents` — the tick counts agents `--start` launched that are not registered yet, with a test that reproduces `agents=0 … started=2` after `--start 3`. → #2458

## Notes

- Source: https://github.com/plot-pm/plot/issues/2409
- Created by `/plot-idea` unattended. Skipped questions: Design question — default, `State: Draft`. Deliverable search: no candidate named for a counting rule (`fleet-start.done` and `plot-dispatch.sh --start` are the related existing artifacts); duplicate check: no plan with a similar title.

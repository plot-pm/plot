# Auto-dispatch asks for the brief

> An approved plan with a free agent needs an operator for one reason only: somebody has to start the brief. The board already knows the command.

## Status

- **State:** Delivered
- **Type:** feature
- **Sprint:** an-agent-is-declared-and-corrected
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-12, jwloka, in-session
- **Started:** 2026-09-12, jwloka, `feature/auto-dispatch-asks-for-the-brief`
- **Rounds:** 1
- **Delivered:** 2026-09-12

## Changelog

- Auto-dispatch runs the configured `Brief command` for a plan it skipped as `no-brief`, then claims the slice on a later pulse. An approved plan with a free agent no longer waits for an operator.

<!-- Board impact: this IS the board. auto-dispatch.ts gains one spawn path;
     rebuild the artifact. -->

## Motivation

**The board claims slices and never writes briefs, so every dispatch needs an operator first.** Measured 2026-09-12 across seven dispatches in one session: each reported `brief_asked=1 dispatched=0` on the first pass, and the claim followed 60–75 seconds later once the brief reached `origin/main`. The board was never the slow part; the missing brief was.

**The skip is documented and tells the operator to act** — `auto-dispatch.ts:605`: *"`no-brief` — every branch it could have started is missing a brief on `origin/main`. The operator runs `/plot-implement`, or the `Brief command` writes one."* Both of those are a person.

**The board already has every piece.** `Brief command` is configured in this repo and read by `plot-dispatch.sh:749`'s neighbour; `approve.ts:295` and `deliver.ts:518` spawn a configured command through `sh -c` because each is a shell FRAGMENT. What is missing is one caller.

**And the gap is invisible.** A plan that is approved, eligible and briefless appears on the board as *waiting*, with the reason only in the server console. An operator watching the board sees a fleet that is not working and no statement of why.

## Design

### Approach

On the pass where auto-dispatch skips a plan as `no-brief`, it runs the configured `Brief command` for that plan and moves on. It claims nothing that pass — the brief has to reach `origin/main` first — and the next pulse finds the brief and claims normally.

That is the shape `plot-dispatch.sh` already has: **ask, do not await**. Its summary reports `brief_asked=N` separately from `dispatched=N` for exactly this reason, and the distinction is stated at `plot-dispatch.sh:109` — *"`brief_asked=N` COUNTS COMMANDS STARTED, NEVER BRIEFS WRITTEN."*

### One brief per plan per pass, and never a second while one is running

The failure this must not create is N brief writers for one slice. Measured 2026-09-11: a foreground dispatch timed out at 2 minutes while `timeout 300` on the inner script outlived it, and re-running produced two `claude -p` briefs for one slug.

So the board records which plans it has asked for, the same way `allInFlight` already records what it dispatched, and a plan with an ask outstanding is skipped rather than re-asked. The record is in memory and per-board, which is enough: a restart loses it, the brief either landed or did not, and the next pass asks again — the same recovery `plot-registryd.mjs` relies on by holding nothing between ticks.

### It respects the agent budget, because a brief costs an agent too

`auto-dispatch.ts:1007` computes `budget = parallelAgents - (liveCount + allInFlight.size)`. A brief writer is a `claude -p` process like any other, so asking for one while the budget is spent starts work the operator capped. The ask is made only with budget to spare, and counts against it until the brief lands.

### An unset `Brief command` is not a failure

A repository that declares none gets today's behaviour exactly: the skip is logged, nothing is spawned, and the operator writes the brief. This is Principle 5 — Plot hardcodes no agent tooling — and it is also why the key is read fresh each pass rather than cached at startup.

### Open Questions

- [ ] Should the board surface `no-brief` in the UI as well? The log is where it lives today, and a plan waiting on a brief nobody will write is exactly the state a board exists to show. Out of scope here; this plan removes most instances of it rather than displaying them.
- [ ] Does an ask that never produces a brief need a bound? A brief command that fails silently leaves the plan asked-for forever until the board restarts. Leaning yes, with the count visible, but no number is measured.

## Slices

### Auto-dispatch asks for the brief (Branch: feature/auto-dispatch-asks-for-the-brief, PR: #902)

The spawn on `no-brief`, the per-plan ask record, and the budget check.

Reuse `approve.ts`'s spawn shape rather than writing a second one: a configured command is a shell fragment, runs through `sh -c`, and its output goes to the same place the other action endpoints send theirs.

**The ask is reported.** A pass that asked for a brief says so, with the plan named, so an operator reading the console sees the fleet acting rather than idling.

## Notes

This closes the last operator step between an approved plan and a working agent. Everything else in that path — eligibility, claiming, the desk, the worker — the fleet already does by itself.

# Fleet: a fresh agent after a wait-bound end, safe supervisor endings, and slice waits

> Three fleet defects (#1903, #1917, #1273): fleetd's answer at `agents=0` after a wait-bound end, a supervisor `unreadable` ending acting on a slice the agent no longer held, and the registry ignoring a `waits:` written on a branch line.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #1950, #1903, #1917, #1273
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- The registry holds a slice on every `waits:` the plan reader returns, wherever on the branch line it is written; a supervisor ending on a free desk no longer restarts or releases a slice the agent did not hold; the plan records whether fleetd starts a fresh agent at `agents=0`.

<!-- Board impact: none expected. No change to the plan format, template or helper scripts; the registry reads the plan through the existing plan-store port. -->

## Motivation

Three defects concern how fleetd and the registry treat a desk at the end of its wait, or before its slice may start. Issue #1950 groups them.

- **#1903** — the row-placement plan (`2026-10-16-row-placement-and-wording-1677-1791`) stops a clean wait-bound end from reading as blocked. It does not change fleetd, and it left open whether fleetd starts a fresh agent when the fleet sits at `agents=0`.
- **#1917** — a free agent whose wait ran out exits `124` and writes no ending (`agentLoop` ROW 2, `packages/domain/src/workflows/agent-loop.ts:473-484`). Its desk still has the last slice's branch checked out. On the next tick `killedWorkerEnding` (`ending-action.ts:553`) writes `{reason: "unreadable", actor: "supervisor", branch}`. With a merged PR, `endingAction` answers `leave`. With an unmerged one, the same ending can reach `start-fresh` or `release-claim` for a slice the agent had handed off. Found 2026-10-16 while fixing #1902; not reproduced.
- **#1273** — measured 2026-10-04: `plot-registryd` handed `infra/the-loop-has-a-workflow` to an agent while the branch its `waits:` names (`infra/the-shell-loop-holds-unlanded-work`, #1271) was open and failing. `plot-plan-meta.sh` read the wait (`waits_on` set, `unread_waits: []`); `plot-dispatch.sh` refused the slice; the registry's plan reading carried no `waitsOn` for a `waits:` written on the branch bullet line, which the plan template allows. After the claim on slice 1 was released, the registry also held slice 2 only on `no-brief`, though it sits behind the unmerged slice 1.

## Design

### Approach

Each member becomes one slice. The slices touch different rules and have no ordering between them.

1. **Registry reads branch-line waits (#1273).** Find where the registry's plan reading builds `waitsOn` (`plan-store-shell.ts`, `rules/queue.ts`, `rules/eligible.ts`) and make it read the same `waits:` annotations as `plot-plan-meta.sh`, on a heading or on a branch line. A test names the failing plan shape (the `waits:` on the bullet). The second defect — slice 2 handed or held on `no-brief` only while slice 1 is unmerged — gets its own failing test before any change; if slice 1 holds on the wait, slice 2 follows from the same rule and needs no second change.
2. **Supervisor ending on a free desk (#1917).** Reproduce first: build the readings for a free agent exiting `124` with a branch checked out and an unmerged PR, run `killedWorkerEnding` then `endingAction`, and record the arm reached. Then decide from the claim: when the branch's claim no longer names this agent, the supervisor acts on nothing from this desk's record. The fix lives in the domain rule; the controller only passes readings.
3. **Fresh agent at `agents=0` (#1903).** Decide whether fleetd starts a fresh agent when the fleet sits at `agents=0` after a wait-bound end, or whether the idle fleet is correct. The decision is recorded in this plan; code follows only if the answer is "start".

Domain rules follow the layering rule in `CLAUDE.md`: new code is arrow functions, with readings as values and no spawn outside an adapter.

### Open Questions

- [ ] #1903: does fleetd start a fresh agent at `agents=0`, or is an idle fleet correct? A wait-bound end means no work was assigned in the bound, so a fresh agent has nothing new to take until the registry assigns something. The reader decides.
- [ ] #1917: which `endingAction` arm does an `unreadable` supervisor ending reach on a free desk with an unmerged branch? Not reproduced; slice 2 starts by measuring it.
- [ ] #1917: at the moment `killedWorkerEnding` runs, does the branch's claim still name this agent? If it always does, the defect is a different one.
- [ ] #1273: does holding slice 1 on its wait also hold slice 2, or does the ordering defect need its own rule?

## Slices

### Registry waits

- `bug/the-registry-reads-branch-line-waits` — the registry holds a slice on every `waits:` the plan reader returns, on a heading or a branch line, and never treats a later slice as next while an earlier one is unmerged (#1273)

### Supervisor endings

- `bug/a-free-desk-ending-acts-on-no-slice` — a supervisor `unreadable` ending on a free desk acts on a slice only while the branch's claim names this agent (#1917)

### Wait-bound fleet

- `bug/fleetd-at-agents-zero-after-a-wait` — fleetd's decision at `agents=0` after a wait-bound end, recorded and implemented if the answer is to start (#1903)

## Notes

- Created from tracker issue #1950. The issue is the problem statement; this plan proposes the slices.
- Nothing is written to the tracker.

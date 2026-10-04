# A landed brief frees its slot

> Auto-dispatch stops asking for briefs once its tally of past asks fills the budget, because an ask never leaves the tally and a free agent counts against it.

## Status

- **State:** Released
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Issue:** #1162
- **Sprint:** the-fleet-runs-through-its-limits
- **Review:** in-session
- **Impl:** own branches
- **Delivered:** 2026-10-02
- **Released:** 2026-10-04, v2.23.0

## Changelog

- Auto-dispatch keeps asking for briefs while slices wait for one: an ask holds a slot only until its brief lands on `origin/main`.
- A plan's later slice gets its brief asked for when it turns eligible.
- A free agent no longer blocks the brief it is waiting for.

## Motivation

Measured 2026-10-02 on this repository: `Parallel agents` 8, one agent idle, 22 slices held by the supervisor on `no-brief`, and the board logging `skipping branch(es) with no brief on origin/main` every pass after three asks. A board restart, which empties the tally, made it ask again within minutes.

The budget is `controls.parallelAgents - (liveCount + allInFlight.size + briefsAsked.size)` (`packages/board/src/server/auto-dispatch.ts:1233-1234`):

- `briefsAsked` only grows. `:1262` adds a plan slug after an ask and nothing removes it, so every brief the board ever asked for keeps a slot until the board restarts (`fleet.ts:726-733` keeps the set for the board's lifetime). It is keyed by plan, so `:1246` skips a plan's second slice for good.
- `liveCount` is `liveAgentCount` (`:122`), every agent in `LIVE_STATES`, including a free agent that holds no branch and waits for exactly the brief the budget refuses.

`allInFlight` is not the defect: `pruneInFlight` (`:878`) already drops a branch once a live agent holds it.

## Design

**Two pure rules in `packages/domain/src/rules/brief-budget.ts`**, arrow functions, readings as values, 100% branch coverage:

- `outstandingAsks(asked: ReadonlySet<string>, missingBriefs: ReadonlySet<string>): Set<string>` keeps an asked branch only while it is still in `missingBriefs`. A branch whose brief landed, or that left the pulse, drops.
- `briefAskBudget({ cap, busyAgents, inFlight, outstanding }): number` answers `max(0, cap - (busyAgents + inFlight + outstanding))`.

**The board applies them.** `briefsAsked` becomes a set of branches, not slugs. Each pass prunes it through `outstandingAsks` before the budget is read, and stores the pruned set back on the cache entry (the same in-memory lifetime as today, so a restart still forgets it). The skip at `:1246` tests the branch `firstBrieflessBranch` names, so a plan's later slice is asked for once its first brief landed. `busyAgents` counts agents in `LIVE_STATES` that hold a branch; the dispatch budget at `:1106` keeps `liveCount` unchanged, because a free agent does take a dispatched slice.

### What this does NOT do

- It does not change when auto-dispatch asks (a `no-brief` plan with budget left) or what the Brief command writes.
- It does not change the dispatch budget at `:1106`.

## Done when

- Unit cases in `packages/domain/test/brief-budget.test.ts`: a landed ask drops from `outstandingAsks`; an outstanding ask stays; a branch absent from the pulse drops; `briefAskBudget` never goes below 0; a free agent is not counted; busy agents alone reach the cap.
- A board unit test drives two auto-dispatch passes with a brief landing between them and asserts the second pass asks for the next plan's brief; a second test asserts a plan's later slice is asked for after its first slice's brief landed.
- `pnpm test`, `pnpm run test:board`, `pnpm run typecheck` and the domain coverage gate pass; a `'@plot-pm/board': patch` changeset (and `plot` only if a skill changes).

## Slices

### A landed brief frees its slot (Branch: bug/a-landed-brief-frees-its-slot, PR: #1163)

The two rules with their tests, the board's switch to branch-keyed asks with per-pass pruning, the `busyAgents` count, and the two board unit tests.

## Implementation brief — the-read-path-stops-spawning (wave 4: Proving)

- **Plan (canonical):** `docs/plans/2026-08-31-the-read-path-stops-spawning.md` on `main`
- **Branch:** `feature/a-read-route-spawns-nothing` (base: `main`)
- **Ends as:** one PR to `main`

**Last. Every migrating wave must land first — a gate over unfinished work is a gate nobody can pass.**

### What to build

The gate: a test asserting no synchronous spawn occurs while a read route is served, plus the `sample` measurement recorded in the plan.

### The measurement this closes

The plan's first `Done when`, and it is deliberately not a latency number:

> **A `sample` of the board under load shows no `SyncProcessRunner::Spawn` below
> a read route's handler.** This is the measurement that found the defect and it
> is the one that closes it — not a latency number, which contention can flatter
> or spoil.

The original reading, for comparison: **4258 of 4262 main-thread samples** under `node::SyncProcessRunner::Spawn`, below the request handler, on a board refusing every request.

### The gate, and what makes it a gate

A rule says *"the read path must not spawn"*. A gate fails a build when it does. This repo's own test: can you answer *"did I do this?"* without doing the work? If yes it is a rule.

**Assert the absence structurally, over the read-path source** — the pattern `no-network.test.ts` and `stubbed-tests-start-no-board.test.ts` already use in this repo. Read those two first; between them they settle comment-stripping (a comment explaining an absence must not fail a grep), naming every spelling of the thing forbidden (`execFileSync`, a bare `spawnSync`, a helper that wraps either), and asserting the population is non-empty — **a gate over an empty set passes and proves nothing.**

**The write routes are NOT in the population.** `idea.ts` (7 spawns), `deliver.ts` (3), `dispatch.ts` (3), `reslice.ts` (3), `continue.ts` (3), `transition.ts` (2), `approve.ts` (2), `commission.ts` (1) are a later plan. A gate that fires on them will be turned off.

### The runtime half

A static gate proves the source does not spawn. The plan also asks for the behaviour:

- `/` answers in single-digit ms **while a read route is in flight**, asserted back to back rather than on a timer. A static file served during a slow API call is the whole property.
- The board still shows a plan added since the last request — asserted, because the tempting wrong fix for latency is a cache that freezes content.

### Report the delta honestly

The Survey's baseline is **456 s** for `pnpm run test:board`; that is the browser plan's number, not this one's. For this plan, state the request profile before and after.

**And if the board did not get faster, say so plainly.** Async makes it RESPONSIVE at the same latency — the plan's third Open Question says so — and *"~770 ms per request is acceptable"* is a separate question this plan deliberately does not answer. A slice that reports a win it did not measure is worse than one reporting no change.

### Done when

- A test fails the build when a read-path source spawns synchronously, and its population is asserted non-empty.
- The `sample` profile after the migration is in the plan, showing no `SyncProcessRunner::Spawn` below a read handler.
- `/` answers in single-digit ms while `/api/board` and `/api/fleet` are in flight.
- Content freshness is asserted, not assumed.
- Repo gates: `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, `pnpm test`, changeset. Node 24 (`nvm use`), `corepack pnpm`.
- **Do not run `pnpm run test:e2e` locally** — it is CI's gate.

### Scope guard

The gate and the report. Anything still spawning on a read path at this point is either a documented exception from wave 3 or a gap the earlier waves missed — and the second is a finding for the PR, not a fix to slip in here.

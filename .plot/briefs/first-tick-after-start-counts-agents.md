## Implementation brief — first-tick-after-start-counts-agents

- **Plan (canonical):** docs/plans/2026-10-23-first-tick-after-start-counts-agents.md on main
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2425 merged
- **Branch:** `bug/first-tick-after-start-counts-agents` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (plot-review app required on main)

One wave, one branch. Nothing waits on it and it waits on nothing.

### What to build

Issue #2409: after `/plot-fleet --start 3`, the first supervisor tick read `agents=0`, held the queue's slice as `no-free-agent=2` and started two more agents. Five ran where the operator asked for three. The cause is in `scaleUp` in `packages/domain/src/workflows/assign.ts`. It computes `running` from registered agents (`readings.agents` whose state is not `none`) plus `verifying` and `specRunning`, and passes `requested: waiting === 0 ? running : fleet.size` to `fleetSize`. An agent that `--start` launched and that has no `.plot/agents/<id>.json` yet is in none of those counts.

The fix counts launched-but-unregistered agents as running. It goes in as a reading on `QueueReadings` (a value the caller supplies), so `scaleUp` stays synchronous and spawns nothing. The adapter side reads whatever `plot-dispatch.sh --start` records for the pids it launched.

### Settled decisions — do not re-derive

- **Fix 2 (the tick counts launched pids), not fix 1 alone.** Fix 1 (`--start` waits for registration) leaves a window whenever the wait times out, and does not cover a supervisor restart. The plan recommends fix 2. Adding fix 1 as well is open (plan Open Questions); record the answer in the plan if you take it.
- **`.plot/state/fleet-start.done` cannot be the source.** `plot-fleetctl.sh:540-561` documents it as a completion time only; it holds no pids. Confirm where `plot-dispatch.sh --start` records launched pids. If nowhere, it must record them, and that is the one shell change this slice may need.
- **The count needs a bound.** A launched agent whose process died before it registered must not count forever. Use pid-alive, a launch age below `Worker bound`, or both, and test the expired case.
- **Rules carried over:** absent is not false — a missing or unparseable launch record means "no unregistered launches", never an error that stops the tick. Read exit codes, not emptiness. Domain code is arrow functions, with TSDoc stating behaviour only; the reasoning goes in the commit message. The layering rule applies: controller → domain → port ← adapter; the domain imports no adapter and spawns nothing.

### Done when

The plan's `## Slices` line is the specification: the tick counts agents `--start` launched that are not registered yet, with a test that reproduces `agents=0 … started=2` after `--start 3`. Add:

- A test that fails on current `main`: three launched, zero registered, queue waiting — expect `start` 0, not 2. It catches an implementation that only changes the log line.
- A test that a launched pid with a dead process, or a launch older than `Worker bound`, adds nothing to `running`. It catches a count that never expires.
- A test that a launched agent that has registered is counted once, not twice (registry entry and launch record). It catches double counting.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The `CI suites` run in CI; a failure there returns as a correction. Add a changeset (description first, `bumps:` block last; package `plot`). If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` refuses net growth: remove shell elsewhere in the same change, or write the rule in the domain. Do not run `test:e2e` locally.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owned: `packages/domain/src/workflows/assign.ts` and its readings type, the fleet adapter that builds `QueueReadings`, `skills/plot/scripts/plot-dispatch.sh` only if it must record pids, and their tests. Other branches in flight on this plan: none. Do not rename `Wave`/`Slice` terms in code you touch beyond need.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

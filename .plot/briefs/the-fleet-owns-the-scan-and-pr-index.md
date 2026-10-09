## Implementation brief — the-fleet-runs-without-the-board (wave 4: The fleet owns the scan and the PR index)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-runs-without-the-board.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-fleet-owns-the-scan-and-pr-index` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

This wave follows `feature/the-supervisor-is-plot-fleetd` (#1428, merged 2026-10-09), which renamed the supervisor. The plan text still says `plot-registryd`; the process, the bundle and the unit are now `plot-fleetd`, and the source files keep their names (`registryd-main.ts`, `registryd.ts`). `feature/the-fleet-owns-its-automatic-writes` (wave 5) waits on this wave and moves auto-dispatch and auto-delivery. Measured 2026-10-09 on `main` at `2182ae41a`: no other branch of this plan is pushed, and no open PR touches `packages/fleet/`, `fleet.ts`, `pulse-bridge.ts` or `plot-fleet-scan.sh`.

### What to build

Today a stopped board process stops the scan, the pulse bridge `.plot/state/last-pulse.json` and the PR index, because `ensureCache` (`packages/board/src/server/fleet.ts`, near `:3990`) subscribes `fleet-scan` to every 5 s beat (`REFRESH_MS`, `:126`) and `pr-reader` to every twelfth (`PR_REFRESH_MS`, `:142`). The fleet's own process, `plot-fleetd`, runs a 60 s supervision tick (`TICK_INTERVAL_MS`, `registryd.ts:76`) and reads the PR index (`prIndexFile`, `registryd-main.ts:705`, `:790`) but writes neither the pulse nor the index. This wave moves the three writes to `plot-fleetd`: the scan on its own clock, `writeBridge` (`fleet.ts:3821`) and `foldPrIndex` (`writePrStore`, `fleet.ts:2999`, called at `:3376`). The board then reads both through a `FleetState` port in `packages/domain/src/ports/` with a file adapter, and it starts no scan while a fleet runs.

Move the code into `@plot-pm/fleet` and make the board import it. Do not copy it. `packages/board/package.json:57` already depends on `@plot-pm/fleet`, and `packages/fleet/test/entry-module-graph.test.mjs` fails the build when a fleet entry pulls in a `packages/board` file, so the dependency can only run board → fleet. Spawn through the existing `Scripts` port. Add no direct `spawn` or `execFile` site: CI's spawn ratchet counts them.

What moves with the scan, and what stays:

- **Moves:** the `--stream` scan call and its budget (`FLEET_SCAN_BUDGET_MS`, 90 s), the two cost caches the board holds in memory (`entry.terminal` as `PLOT_TERMINAL_CACHE`, `entry.listing` as `PLOT_PR_LISTING`) with the `listingSpend` decision, and the four reads the bridge carries beyond the pulse: `branchAges`, `readBranchUrlBase`, `approvalDates`, `ideaPlanFiles` (`fleet.ts:1470`, `:1710`, `:1652`, `:1572`).
- **Moves with the PR writer:** `refreshPrs` (`:3035`), its cadence gate, its rate-limit reaction (`hostReaction`, `applyReaction`, `scheduleNextPr`) and `writePrStore`. The gate and the writer travel together, because one process must own the host budget.
- **Stays in the board:** the display-only reads (`readAgentRegistryWithInfo`, `readSupervisor`, `unmergedBranches`, `workerQuestions`, `releaseVersions`, `readMachine`), the served maps, and `refreshIssues` (see below).

### Decisions the plan settles — do not re-derive them

**The seam is files read through a port, not a socket.** A socket makes the board depend on a live fleet process, which turns the coupling around. The plan and the operator settled this on 2026-10-09.

**With no fleet running, the board scans on demand for display and writes nothing.** The operator answered this on 2026-10-09. One consequence is not in the plan and is the first trap: `plot-fleet-scan.sh:314` sets `record=1` for `--stream`, so the board's own on-demand scan writes `last-pulse.json` from inside the shell (`write_bridge`, `:5167`). "Writes nothing" is therefore false until the scan has a way not to record. Add one narrow switch to the scan (a flag or an env var) that sets `record=0`, and have the board pass it. `--log-pulse` must keep recording: `/plot-pulse` in a repository with no fleet and no board depends on it (`:222-230` of the script says why).

**The shell's bridge write is thin, and the last writer wins.** `write_bridge` writes `"ages":[],"branchUrlBase":"","approvedAt":[],"ideaPlans":[]` and the board overwrites it afterwards with the real values (`fleet.ts:3821`). Measured on `main`: two writers, one file, and the board's write lands second. If `plot-fleetd` runs `--stream` and does not write the full payload after the scan returns, the thin shell write becomes the final content and the board shows no ages, no approval dates and no idea-branch plan files. Every test that checks "a bridge exists" passes in that state. The fleet's TypeScript write must come after the scan and must carry all six fields, and `readBridge` (`pulse-bridge.ts:184`) keeps its version check and 15-minute expiry (`BRIDGE_MAX_AGE_MS`).

**A scan that fails must not overwrite the last good bridge.** The board enforces this by writing inside the success path only (`fleet.ts:3815-3828`). Keep that placement in the fleet. A `--watch` restart storm is what this rule protects against, and it was measured on 2026-08-17.

**The fleet keeps the 5 s scan cadence and does not ride the 60 s tick.** The Agents tab polls every 4 s and dims by age. A pulse that is up to 60 s old, against up to 5 s old today, is a visible regression that no unit test of the writer shows. Reuse the pulse clock the board uses (`startPulse(clockSystem(), REFRESH_MS)` and `divisorFor`, domain code) in `registryd-main.ts`. The scan must not run inside `tick()`: a scan has a 90 s budget, and the daemon's loop is `await tick(...)` then `await sleep(args.intervalMs)` (`registryd-main.ts:1758`, `:1787`, `:1869`). A scan inside the tick would delay supervision by up to 90 s, and a tick waiting on a scan would delay the next beat. Give the scan its own in-flight guard (the board's `entry.running`, `fleet.ts:3487`) so a slow scan never starts a second one.

**One writer of `foldPrIndex`.** `CLAUDE.md` § *A Decision Reads The Index*: `fleet.ts` is the only caller today, and the fleet code is the only caller after this wave. `rename` makes each write atomic and does not make the read-fold-write sequence around it atomic, so a second writer races. The board and every shell consumer read and never write.

**The board stops asking the host about PRs while a fleet runs.** The fleet owns the host budget (`CLAUDE.md` § *The Layering Rule*: the rate-limit contract belongs to the connector). If both processes ask, the host sees double the calls and the cadence gate protects nothing. The board derives its served maps (`map`, `byNumber`, `byHead`) from `PrIndexStore.read`, the same fold the writer returns today (`fleet.ts:3363-3376`: "THE SERVED MAPS COME FROM THE FOLD").

**With no fleet running, the PR side follows the scan's answer.** The operator's answer covers the pulse only. The consistent reading, and the default for this wave: the board keeps `refreshPrs` for in-memory display when no fleet runs and does not write the store. State in the PR description that this is an inference from the pulse answer.

**`refreshIssues` stays in the board.** It shares the PR gate today (`maybeRefreshPrs`, `fleet.ts:3467`) only so that it cannot become a second cadence. The tracker is a separate connector with its own account and window (`CLAUDE.md` § *The Layering Rule*), so it does not spend the host's budget. Give it its own 60 s gate in the board when `refreshPrs` leaves. Moving the tracker is a different plan.

**How the board knows a fleet runs.** The plan proposes a switch file under `.plot/state/`. The board already reads `readSupervisor` on every refresh (`fleet.ts:3549`, `supervisor-reading.ts:145`), the product of `the-board-says-whether-anything-supervises` (Released). Use that reading and add no second liveness signal. If it cannot tell a live `plot-fleetd` from an installed-but-dead unit, the switch file is the fallback; say which one you used and why in the PR.

**The index never says no.** The index supplies `pr: 'MERGED'` and never `pr: 'none'`. A missing store, a wrong-version store and an unparseable store all mean *ask the host*. The `FleetState` adapter returns values, as `PrIndexStore` does (`PortResult`), and does not throw on a missing file. A board reading a bridge older than `BRIDGE_MAX_AGE_MS` has no data and says so through the existing stale rendering.

**Answers, never verdicts.** The bridge is the existing exception: it holds a pulse, which `readBridge` expires. Persist no verdict, no wave eligibility and no "dispatch due" flag in `.plot/state/` (`fleet.ts:2413` refuses a persisted verdict for a stated reason).

**The auto-writes stay in the board in this wave, and they must keep firing — the second trap.** Auto-dispatch and auto-delivery run inside the board's `refresh()` success path, from the pulse the board just scanned (`fleet.ts:3854`, `:3884`). Wave 5 moves them. If the board stops scanning while a fleet runs and nothing else triggers them, auto-dispatch stops whenever `plot-fleetd` is up. All of this wave's tests pass in that state, and it is the shape of the failure measured on 2026-10-01, when three slices sat with no worker. The plan's rule is that the fleet works after each slice. Direction: while a fleet owns the scan, the board's `refresh()` takes `complete` from the bridge (a pulse newer than the last one it acted on) and runs the same two calls on it; the calls are removed in wave 5. The bridge's `pulse` is the same `FleetReading` as `complete`, and `entry.agents` and `readMachine` come from reads the board already does. If this proves impossible, write a `PLOT-BLOCKED` marker that names what is missing. Do not leave auto-dispatch dead.

**Rules carried over unchanged:** new code in `packages/fleet/` and `packages/domain/` is arrow functions (`export const f = (...) =>`), and so is any function you write elsewhere. TSDoc says what an export does, takes, returns and how it fails; the reasoning goes in the commit message. The domain takes readings as values and imports `zod` and nothing else outside `adapters/`. New code says Slice where it means Slice, not Wave. `Worker` names a process and `Agent` names the actor. An absent field stays absent. Read an exit code, not the emptiness of the output.

### Done when

The plan has no `## Done when` list. This wave's line in `## Slices` is the specification: `plot-fleetd` (named `plot-registryd` in the plan) runs the scan on its own clock, writes the pulse bridge and is the only caller of `foldPrIndex`, and the board reads both through a `FleetState` port. The assertions below exist because a naive implementation passes without them:

- **The fleet's bridge carries real values.** After a scan in a sandbox with at least one branch and one approved plan, `last-pulse.json` has a non-empty `ages`, `approvedAt` and `branchUrlBase`. It catches the thin shell payload being the last write.
- **A failed scan leaves the previous bridge byte-identical.** It catches a write moved out of the success path.
- **The board makes zero scan spawns, zero `writeBridge` calls and zero `foldPrIndex` calls while a fleet runs.** Assert it with spies on the `Scripts` port and the stores. It catches the board and the fleet both scanning, and a second index writer.
- **The board alone leaves `last-pulse.json` unchanged.** Compare content before and after one on-demand scan. It catches `--stream` recording through the shell.
- **One caller of `foldPrIndex`.** A test lists the files that import it from the domain and asserts they are all under `packages/fleet/`. It catches a board file reaching for it later.
- **A slow scan does not delay a tick, and a tick does not start a second scan.** Drive the daemon loop with an injected clock and a scan that takes longer than the tick interval. It catches the scan inside `tick()`.
- **A rate-limited host holds its full delay in the fleet.** Port the board's existing `applyReaction` and `scheduleNextPr` tests; do not weaken them. It catches the gate moving without the backoff.
- **Auto-dispatch fires from the bridged pulse.** With a fleet owning the scan and an eligible slice, the board's auto-dispatch is called once per new pulse and not on a pulse it already acted on. It catches the second trap.
- **A board restart with a fleet running shows the bridged pulse without scanning.** It catches the board re-deriving what the fleet already wrote.
- **`entry-module-graph.test.mjs` still passes.** The fleet entries import nothing from `packages/board`.

Plus: add a changeset (`./scripts/check-changeset-packages.sh`; package `plot` or `@plot-pm/board`; the description first and the `bumps:` block and the `plan:` line last). The shipped bundles under `skills/plot/scripts/board/` are generated: do not commit a rebuilt bundle (`scripts/check-no-bundle-diff.sh`). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally.

This wave touches `skills/plot/scripts/plot-fleet-scan.sh`, so `scripts/check-shell-lines.sh` applies: it refuses a pull request whose shell under `skills/` is longer than at its merge base. The record switch adds lines. Pay for them in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Update the script's row in `skills/plot/scripts/README.md` if the flag changes what the scan answers.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: the new scan clock, bridge writer and PR refresh in `packages/fleet/src/`; `packages/domain/src/ports/fleet-state.ts` and its file adapter under `adapters/`; the removal of the scan subscription, `writeBridge` and `writePrStore` calls from `packages/board/src/server/fleet.ts`; `pulse-bridge.ts` (the reader moves behind the port); the record switch in `plot-fleet-scan.sh`; and their tests.

This branch does not own, and leaves in place: `maybeAutoDispatch` and `maybeAutoDeliver` and their in-flight state (wave 5); the controller routes in `index.ts` and `/api/fleet-controls` (waves 5 and 6); `controllers/fleet-state.ts`, which serves `plot-ask.mjs board|fleet` and keeps its export name, `fleetState`, beside the new `FleetState` port. If the two names collide in an import, report it and do not rename the controller in this wave.

The branch `origin/feature/a-merged-pending-check-is-asked-again` still exists and edits `fleet.ts` and `rules/pr-index.ts`. Its plan deferred it (PR #1425 is closed), so it is not in flight; do not build on it and do not rebase onto it. The branch `feature/approval-becomes-a-command` is in flight and touches only the domain's trees, hold-clear and sprint-annotation rules; no collision is expected.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

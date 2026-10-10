# The fleet runs without the board

> Auto-dispatch, auto-delivery, the fleet scan's clock and the PR index's one writer move out of the board server into the fleet's own process; the fleet's bundles stop importing board modules; the board reads the fleet's state and starts nothing.

## Status

- **State:** Delivered
- **Type:** infra
- **Issue:** #1407
- **Story:** the-shell-holds-no-behavior
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-09, jwloka, in-session
- **Started:** 2026-10-09, jwloka, `feature/the-fleet-bundles-import-no-board`
- **Started:** 2026-10-09, jwloka, `feature/the-fleet-package-exists`
- **Started:** 2026-10-09, jwloka, `feature/the-supervisor-is-plot-fleetd`
- **Started:** 2026-10-09, jwloka, `feature/the-fleet-owns-the-scan-and-pr-index`
- **Started:** 2026-10-10, jwloka, `feature/the-fleet-owns-its-automatic-writes`
- **Started:** 2026-10-10, jwloka, `feature/the-controllers-are-commands`
- **Delivered:** 2026-10-10

## Changelog

- The fleet runs with no board process. `plot-registryd` dispatches eligible slices, delivers finished plans and keeps the PR index current on its own clock; the board shows that state and no longer starts any of it.
- Stopping or restarting the board ends no agent and stops no dispatch.
- The fleet's bundles (`plot-registryd.mjs`, `plot-worker-loop.mjs`, `plot-fleet-size.mjs`) are built from a package that does not import `packages/board`.

<!-- Board impact: large. The board loses its three automatic writes (fleet.ts:3828, :3853, :3880) and the PR index write (fleet.ts:3375), and gains a reading of the fleet's state through a port. No change to the plan format, the template or the docs/plans layout. Each slice that moves an entry changes packages/board/build.mjs, and the shipped bundles under skills/plot/scripts/board/ keep their names. -->

## Motivation

The operator decided on 2026-10-09 that the fleet separates from the board entirely: the fleet runs with no board process, and the board reads the fleet's state (story `the-shell-holds-no-behavior`, *Decisions Taken in Scoping*). Today a closed board tab is harmless, but a stopped board process stops auto-dispatch, auto-delivery and the PR index, and the fleet's own supervisor imports board modules to start.

**The issue's picture, corrected by measurement.** Measured on `main` at `485feeed6`, 2026-10-09:

- **The supervisor already runs outside the board.** `plot-registryd.mjs` is its own process, started by `plot-fleetctl.sh:117` under the service label `com.plot-pm.registryd` (`plot-fleetctl.sh:84`). It does not run in the board process. It is built from `packages/board`, and it imports board modules.
- **What runs in the board process is the scan and the three automatic writes.** These are auto-dispatch, auto-delivery and the PR index write, and all of them run on the board's refresh clock.
- **`plot-ask.mjs` reaches no lifecycle controller.** `entry/main.ts:89-91` accepts `board`, `fleet` and `deliverable`, and `:120-127` adds `release-claim`. Dispatch, continue, approve, deliver, idea, implement, drop, reslice, commission and release are HTTP routes only. `CLAUDE.md` § *The Master Agent Uses The Controllers* says nine actions are *"reachable without HTTP through `plot-ask.mjs`"*. That sentence is false today, and slice 4 corrects it.
- **#1307 may already be fixed in code.** `continue.ts:1049` re-parents the started loop so that `plot-boardctl.sh`'s `tree_pids` (`:174`) no longer finds it. That landed in `9c344e414` (#1351, 2026-10-08), and #1307 is still open. Slice 1 verifies it.

### Process dependencies: what stops when the board stops

| # | What | Where it runs | Evidence |
|---|---|---|---|
| P1 | The fleet scan's clock: `refresh()` runs `plot-fleet-scan.sh` and builds the pulse | board process | `fleet.ts:3485` |
| P2 | The pulse bridge `.plot/state/last-pulse.json`, which `plot-fleet-scan.sh` and `entry/delta.ts` read | written by the board only | `fleet.ts:3820`, `pulse-bridge.ts:147`; reader `plot-fleet-scan.sh:222` |
| P3 | Auto-dispatch: plans and spawns `plot-dispatch.sh` per eligible plan | board process | `fleet.ts:3853` → `auto-dispatch.ts:1011` `maybeAutoDispatch` → `:972` `scriptsFor(opts).start(DISPATCH_SCRIPT, …)` |
| P4 | The machine reading that auto-dispatch defers on | board process | `fleet.ts:3852` `readMachine` |
| P5 | Auto-delivery and the reap behind it | board process | `fleet.ts:3880` → `auto-deliver.ts:577` → `:380` `runAutoDeliver` |
| P6 | In-flight state that spans pulses: `autoInFlight`, `deliverInFlight`, `briefsAsked` | board memory, lost on restart | `fleet.ts:807`, `:837`, `:3853-3880` |
| P7 | The PR index's one writer | board process | `refreshPrs` `fleet.ts:3034` → `:3375` `writePrStore` (`:2998`) → `:3007` `foldPrIndex`. Readers `plot-impl-status.sh` and `plot-reconcile-scan.sh` fall back to the host when the store is stale, so a stopped board costs host calls, not answers |
| P8 | Fleet controls (auto-dispatch switch, parallel-agent cap): the write | board HTTP route | `index.ts:390` `/api/fleet-controls`; reader `fleet-settings.ts:186` |
| P9 | The lifecycle controllers the master agent calls | board HTTP routes | `index.ts`: `/api/approve` :237, `/api/release` :246, `/api/continue` :259, `/api/dispatch` :260, `/api/idea` :273, `/api/commission` :298, `/api/reslice` :320, `/api/deliver` :337, `/api/implement` :352, `/api/claim` :365, `/api/transition` :372, `/api/registry/drop` :402, `/api/release-claim` :416 |
| P10 | Agents that `/api/continue` starts | spawned by the board process; re-parented since #1351 | `continue.ts:1049-1101`; `plot-boardctl.sh:532-537` kills the tree that `tree_pids` (`:174`) returns |

### Build dependencies: what the fleet's bundles import from `packages/board`

| Bundle | Entry (`build.mjs`) | Board modules it imports | What they drag in |
|---|---|---|---|
| `plot-registryd.mjs` | `entry/registryd-main.ts` (`:404`) | `registry.js` :52, `fleet-settings.js` :53, `board.js` :54 and :113 (`readConfig`), `worker-question.js` :55, `escalations.js` :56, `supervisor.js` :64, `queue-reading.js` :70, `registryd.js` :71, `release-claim.js` :96, `process-log.js` :112, `continue.js` :114 | `board.ts` → `dispatch.ts`, `fleet.ts` (`board.ts:66-67`); `continue.ts` → `node:http`, `controllers/caller.js`, `agent-panel.js`, `fleet.js` (`continue.ts:2-28`); `fleet-settings.ts` and `release-claim.ts` → `node:http` |
| `plot-worker-loop.mjs` | `entry/worker-loop.ts` (`:434`) | `prompt.js` :72, `loop-writes.js` :74 (both domain-only), `continue.js` :75 for the constant `CONTINUATION_NAME` | the `continue.ts` graph above, unless the bundler drops it |
| `plot-fleet-size.mjs` | `entry/fleet-size.ts` (`:630`) | none: `rules/fleet-size` and `entities/machine` only | — |
| `plot-ask.mjs` | `entry/main.ts` (`:158`) | `board.js` :4, `estate.js` :5, `board-run.js` :6, `release-claim.js` :7, `ask.js` :8 → `controllers/fleet-state.js`, `controllers/deliverability.js` | `controllers/fleet-state.ts` → `board.js`, `fleet.js` |

Shell launchers of these bundles: `plot-fleetctl.sh:117` (registryd), `plot-worker-loop.sh:15`, `plot-dispatch.sh:2409` (fleet-size). Their paths under `skills/plot/scripts/board/` stay.

## Design

### Approach

**Target shape.** A new workspace package, `@plot-pm/fleet`, holds the fleet runtime: the supervisor tick (`registryd.ts`), the agent loop (`worker-loop.ts`), auto-dispatch, auto-delivery, the fleet scan's clock and the PR index write. Its process is `plot-registryd`, which already exists and already runs under a service manager. Choosing a fleet package over *the domain plus a fleet entry* is deliberate. The domain takes readings as values and spawns nothing (*A note on shape* in `CLAUDE.md`), and auto-dispatch is a clock that spawns. A clock is runtime, and the runtime gets a package of its own. The rules it applies stay in `@plot-pm/domain`. `planAutoDispatch` (`auto-dispatch.ts:465`) is pure today and moves to `packages/domain/src/rules/` as an arrow function.

```
fleet process (plot-registryd)          board process
  controller ─► domain ─► port ◄─ adapter   controller ─► domain ─► port ◄─ adapter
  writes .plot/state/ (pulse, PR index,                   reads .plot/state/ through
  in-flight, fleet settings)                              a fleet-state port; starts nothing
```

**The seam between them is files under `.plot/state/`, read through a port.** That directory already holds the pulse bridge and the fleet settings, and the PR index has a port (`ports/pr-index.ts`). The board gets one `FleetState` port with a file adapter, and it opens no socket to the fleet. A socket would make the board depend on a live fleet process, which turns the coupling around instead of removing it. *One writer* (`CLAUDE.md` § *A Decision Reads The Index*) holds: the PR index moves its writer, and it does not gain a second one.

**The controllers leave the board's HTTP routes, and the board becomes one caller of them.** Each lifecycle action gets a JS entry reachable from the shell, as `plot-deliver.sh` and `plot-open-pr.sh` already are. The board's routes call the same entry. This is the layering rule applied to the board: a controller calls the domain, and the board is an adapter that renders and routes.

**Slices are ordered so the fleet works after each one.** Each move runs in both places for at most one slice, and a switch in `.plot/state/` names which process owns the clock. Two clocks never dispatch the same plan. The action receipt and the ref-push claim already make a second dispatch of a claimed branch a refusal and not a duplicate, and the switch keeps that refusal from being the normal path.

1. **The bundles stop importing the board.** `CONTINUATION_NAME`, `readConfig` and the fleet-settings reader move to the domain or to a shared module with no `node:http` import. `worker-loop.ts` and `registryd-main.ts` import nothing from `packages/board/src/server/` outside `entry/`. A test in the shape of `test/worker-loop-bundle.test.mjs` proves the shipped `plot-registryd.mjs` and `plot-worker-loop.mjs` carry no `node:http` and no `board.ts` code. Nothing changes at runtime. The slice also verifies P10 by stopping a board that has a continued agent under it in a sandbox, then closes #1307 or files what remains.
2. **The fleet package exists.** `packages/fleet` (`@plot-pm/fleet`) takes the entries `registryd-main.ts`, `registryd.ts`, `worker-loop.ts`, `fleet-size.ts` and their non-domain dependencies. `build.mjs` for the fleet emits the same three bundle names into `skills/plot/scripts/board/`. `check-changeset-packages.sh` reads `packages/*/package.json`, so the new name passes without a code change. CI's purity and spawn ratchets (`ci.yml`) extend to the new package. Nothing changes at runtime.
3. **The fleet owns the scan's clock and the PR index.** `plot-registryd` runs the scan on its own interval, writes the pulse bridge and is the only caller of `foldPrIndex`. The board reads the bridge and the store through the `FleetState` port. When no fleet process runs, the board scans on demand for display and writes nothing. A board started alone still shows a fresh pulse.
4. **The fleet owns auto-dispatch and auto-delivery.** `maybeAutoDispatch`, `maybeAutoDeliver` and their in-flight state move into the registryd tick. The in-flight sets persist under `.plot/state/` instead of in board memory (P6), so a restart no longer forgets a dispatch that has not pushed its ref yet. `/api/fleet-controls` writes the settings file and nothing else. The board's three automatic writes are removed (`fleet.ts:3828-3880`). The slice also corrects the `plot-ask.mjs` sentence in `CLAUDE.md`.
5. **The controllers are commands.** `dispatch`, `continue`, `release`, `approve` and the remaining P9 routes get JS entries under the fleet package or under `entry/`, which the master agent and the board both call. `/api/continue` starts its agent through the fleet entry, so the board is never an agent's parent. Slice 5 is the largest and may split during interrogation. Slices 1-4 deliver the operator's decision without it.

**Constraint check.** Controller → domain → port ← adapter holds in both processes. The long-lived per-pass process that Phase 2 of the story may call for is `plot-registryd` and never the board. The PR index keeps one writer. The board starts no process after slice 4, except the on-demand display scan in slice 3.

### Open Questions

- [x] The display scan in slice 3 — *answered 2026-10-09, jwloka: with no fleet process running, the board scans on demand, writes nothing, and names the absent fleet in its header.*
- [x] Package or entry for the controllers (slice 5) — *answered 2026-10-09, jwloka: lifecycle controllers that are not fleet behaviour (approve, idea, deliver, release) go to a third package, `@plot-pm/commands`. Fleet controllers (dispatch, continue) go to `@plot-pm/fleet`. The master agent, the skills and the board call the same entries.*
- [x] Is `plot-registryd` the right name? — *answered 2026-10-09, jwloka: rename it to `plot-fleetd`. The slice *The supervisor is plot-fleetd* renames the bundle, `plot-fleetctl.sh`'s references and the service label, and migrates installed units.*
- [x] Ordering against Phase 2 — *this plan does not wait for `one-agent-pass-costs-what-its`; that plan's route 2 runs in the agent's JS loop or in the fleet package, never in the board.*

## Slices

### The bundles stop importing the board

- `feature/the-fleet-bundles-import-no-board` — `registryd-main.ts` and `worker-loop.ts` import nothing from `packages/board/src/server/` outside `entry/`; a bundle test proves no `node:http` and no `board.ts` code ships in either; #1307 verified → #1413 <!-- builds: a bundle-content test for plot-registryd.mjs and plot-worker-loop.mjs -->

### The fleet package exists

- `feature/the-fleet-package-exists` — `@plot-pm/fleet` holds the fleet entries and builds the same three bundle names; CI ratchets cover it → #1421 <!-- builds: @plot-pm/fleet, a workspace package -->

### The supervisor is plot-fleetd

- `feature/the-supervisor-is-plot-fleetd` — `plot-registryd` becomes `plot-fleetd`: the bundle, `plot-fleetctl.sh`, the service label and the docs use the new name, and an installed unit under the old label is migrated, not orphaned → #1428 <!-- builds: plot-fleetd.mjs and a unit migration in plot-fleetctl.sh -->

### The supervisor logs as fleetd

- `bug/the-supervisor-logs-as-fleetd` — the daemon and the launchd unit write `.plot/logs/fleetd.log` and `.plot/logs/fleetd.err`; `plot-fleetctl.sh --status` reads the tick age from `fleetd.log` and from `registryd.log` while a unit filled before the rename has not been filled again <!-- builds: the fleetd.log and fleetd.err log names -->

### The fleet owns the scan and the PR index

- `feature/the-fleet-owns-the-scan-and-pr-index` — `plot-registryd` runs the scan on its own clock, writes the pulse bridge and is the only caller of `foldPrIndex`; the board reads both through a `FleetState` port → #1444 <!-- builds: FleetState, a domain port with a file adapter -->

### The fleet owns its automatic writes

- `feature/the-fleet-owns-its-automatic-writes` — auto-dispatch and auto-delivery run in the registryd tick with in-flight state under `.plot/state/`; the board's three automatic writes are removed → #1452 <!-- builds: planAutoDispatch moved to packages/domain/src/rules -->

### The controllers are commands

- `feature/the-controllers-are-commands` — the P9 routes become JS entries that the master agent and the board both call; `/api/continue` starts agents through the fleet entry <!-- builds: JS entries for dispatch, continue and release --> → #1457

## Notes

- **2026-10-09, `/plot-idea`, unattended.** Generated from issue #1407. The Type `feature` was given in the input, and the issue itself says `infra`. The input wins, because the skill forbids inferring the Type. The reviewer may change it before approval.
- **Ceremony answers chosen without a person.** `in-session` + `own branches` follows the sibling plan `the-shell-sheds-its-decisions` (#1404) in the same story. The repo declares no `Plan PRs` bound.
- **Deliverable search.** `plot-deliverable-search.sh` found no `fleet package`, no `plot-fleetd` and no `FleetState` port. `controllers/fleet-state.ts` exists in the board as the reading behind `plot-ask.mjs board|fleet`. Slice 3's port replaces what it reads, and does not duplicate it.
- **Prior plans in this direction:** `the-domain-moves-out-of-the-board` (Released), `the-board-decides-nothing` (Released), `the-board-says-whether-anything-supervises` (Released).

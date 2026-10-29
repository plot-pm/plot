# No controller restarts a stopped slice desk

> A claimed slice whose worker is `stalled`, `failed`, `ended` or `none` has no controller route to a new worker. `plot-dispatch.sh --restart <branch>` does it, and nothing a master agent may call reaches it.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** follow-ups-2-29-1
- **Issue:** #2784
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2788 merged
- **Started:** 2026-10-27, Jan Wloka, `bug/a-stopped-slice-has-a-restart-controller`
- **Started:** 2026-10-28, Jan Wloka, `bug/a-fleet-start-restarts-what-its-stop-stopped`
- **Delivered:** 2026-10-28
- **Released:** 2026-10-29, v2.29.1

## Changelog

- A master agent restarts the worker of a claimed slice on its existing desk through the `restart` controller action, on the board and in a board-free bundle. The action refuses by name for an open or merged PR, an unanswerable PR check, a live loop, a `PLOT-BLOCKED` marker and an unattended caller.
- `plot-fleetctl.sh --start` restarts the slices that the previous `plot-fleetctl.sh --stop` stopped, through the same `restart` controller. A slice that a person stopped with `plot-dispatch.sh --stop` stays stopped.

<!-- Board impact: a new action endpoint `POST /api/restart` and a Restart action on the row of a claimed slice whose worker is dead; the row state is a domain property. No change to the plan format, template or docs/plans layout. Rebuild the board artifact when the endpoint is added. -->

## Motivation

Measured 2026-10-27 (issue #2784):

- `plot-fleetctl.sh --stop` at 15:06 sent SIGTERM to the worker of `bug/the-reaper-reads-a-reused-pid-as-a-live-worker` (exit 143). `--start 8` then started 7 free desks and did not restart this one.
- The pulse row read `worker: failed`, `startability: someone-is-on-it`, `group: waiting-on-you`. The slice stayed parked for about 90 minutes until a person acted.
- `plot-dispatch-command.mjs the-reaper-keeps-leftovers-that-no` ran a brief-only implement and restarted nothing.
- `plot-continue-command.mjs <branch> <answer>` refused `no-question`, because the desk holds no `PLOT-BLOCKED` marker.

The cost is a claimed slice parked until a person acts. The free desks that stayed idle in the same period are not this gap's cost: a free desk takes only an open slice, by design, and neither slice below changes that.

`plot-dispatch.sh --restart <branch>` restarts the worker on the existing desk. No board endpoint and no board-free bundle calls it. *The Master Agent Uses The Controllers* in `CLAUDE.md` forbids calling the script directly, so a master agent that follows the rule has no route. The controller gate does not enforce this today: `NO_ENDPOINT` exempts `--restart` (`packages/domain/src/rules/ci-suite.ts:332`), and `test/reconcile/controller-gate.test.mjs:328-339` asserts that exemption.

`plot-dispatch.sh --stop` writes a `stopped` ending with actor `operator` (`plot-dispatch.sh:1882-1887`), and `endingAction` answers `leave` for it deliberately (`packages/domain/src/rules/ending-action.ts:149`): the person who stopped a slice decides what happens next. `plot-fleetctl.sh --stop` stops each slice through `plot-dispatch.sh --stop` (`plot-fleetctl.sh:1296`), so a fleet-wide stop writes the same ending. The supervisor leaves every one of those desks, and `--start` has no record of which slices it should restart.

The domain already holds `restartWorker` (`packages/domain/src/workflows/dispatch-verbs.ts:177`). Only its unit tests call it, and it has no live-loop reading. The shell holds a second copy of the same decision, `handover_refusal` (`plot-dispatch.sh:1028`), whose only caller is `--restart`.

## Design

### Approach

**Slice 1: the `restart` controller.**

1. **The rule.** Extend `restartWorker` and write no new rule. It accepts the script's set of worker states — `stalled`, `failed`, `ended`, `none` — and refuses in the script's order: an open or merged PR first, then a live loop (a new `DeskLoop` reading, as `continueTarget` has), then a `PLOT-BLOCKED` marker. `finished` stays out. The PR reading is `true | false | 'unanswerable'`, and `unanswerable` refuses `pr-unanswerable`. Under `PLOT_UNATTENDED=1` the action refuses.
2. **The start path.** Extend `continueOnDesk` with a restart precondition. The restart takes `.plot-worker.continue.lock` across read, decide and start, the same lock that `/api/continue` and fleetd's fresh start take, so two starters never land on one desk. At start the restart supersedes `.plot-worker.ending.json`, so a restarted worker that dies without an ending reaches `killedWorkerEnding`.
3. **The controller.** `POST /api/restart {"branch":"<branch>"}` on the board and `plot-restart-command.mjs <branch>` with no board, in the shape of `continue`. Each refusal has a name. The board row of a claimed slice whose worker is dead offers the Restart action, and the domain computes that row state.
4. **One rule.** `plot-dispatch.sh --restart` asks the domain through the bundle, and `handover_refusal` goes. The shell line count drops.
5. **The gate.** Remove `--restart` from `NO_ENDPOINT`, route its refusal to `plot-restart-command.mjs <branch>` and `POST /api/restart`, flip `controller-gate.test.mjs:328-339`, and spend the receipt on the restart path. `supervise.ts:285` names the controller, not the script.

**Slice 2: a fleet start restarts what its stop stopped.** It lands after slice 1.

- `plot-fleetctl.sh --stop` keeps the `stopped` ending, which answers `leave` as a person's stop does. It also records the list of branches it stopped.
- `plot-fleetctl.sh --start` restarts exactly the branches on that list, each through the slice-1 `restart` controller, so every slice-1 refusal applies. A branch that a person stopped with `plot-dispatch.sh --stop` is not on the list and stays stopped.
- The domain decides which listed branches to restart. plot-fleetctl.sh holds no restart logic; it calls the bundle. `scripts/check-shell-lines.sh` grants no exemption, so the slice adds no net shell lines.
- fleetd never restarts a stopped slice by itself.

Layering follows *The Layering Rule*: controller, domain, port, adapter, script.

### Decisions

Decided 2026-10-27 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-27-no-controller-restarts-a-stopped-slice/panel.md`):

- [x] Route 1, route 2, or both? Both: slice 1 is the controller, slice 2 the fleet-stop change, landing after slice 1. The fleet-stop logic lives in the domain.
- [x] Should fleetd restart a stopped slice by itself? No. `stopped` answers `leave` deliberately (`ending-action.ts:149`); the row exists. `--start` restarts only the branches `--stop` recorded.
- [x] Which states are restartable? The script's set: `stalled`, `failed`, `ended`, `none`, behind the PR, loop and marker refusals in that order. `finished` stays out.
- [x] A new rule or `restartWorker`? Extend `restartWorker` with a live-loop reading.
- [x] One rule or a declared duplicate? One rule: `--restart` asks the domain, and `handover_refusal` goes.
- [x] Start path: `continueOnDesk` with a restart precondition, under `.plot-worker.continue.lock`.
- [x] Host unreachable during the PR check: refuse `pr-unanswerable`.
- [x] The old ending: superseded at restart.
- [x] The gate: changed in slice 1.
- [x] Unattended caller: refused.

## Slices

### Restart controller

- `bug/a-stopped-slice-has-a-restart-controller` — extend `restartWorker` (live loop, `pr-unanswerable`, unattended refusal), a restart precondition on `continueOnDesk` under the continue lock, the superseded ending, `POST /api/restart`, `plot-restart-command.mjs`, the Restart row state, `--restart` asking the domain with `handover_refusal` removed, and the gate change <!-- builds: the restart controller action --> → #2799

### A fleet start restarts what its stop stopped

- `bug/a-fleet-start-restarts-what-its-stop-stopped` — `plot-fleetctl.sh --stop` records the branches it stopped, the domain decides which of them to restart, and `--start` restarts them through the slice-1 controller <!-- builds: the fleet stop list and its restart --> → #2805

## Done when

Each test below fails on `origin/main` today:

- Domain, `restartWorker`: an open PR refuses `reached-review`; a merged PR refuses `reached-review`; an unanswerable PR refuses `pr-unanswerable`; a live loop refuses `loop-alive` whatever the state word; a `PLOT-BLOCKED` marker refuses `blocked-marker`; `running` and `finished` refuse; `PLOT_UNATTENDED=1` refuses; `stalled`, `failed`, `ended` and `none` with none of these accept. The refusals come in the order PR, loop, marker.
- Start path: a restart and a continue on one desk serialise on `.plot-worker.continue.lock`; a restarted worker killed without an ending reaches `killedWorkerEnding`.
- Bundle: `plot-restart-command.mjs` exits 2 with no branch, refuses `unknown-branch` and `no-worktree` by name, and starts a new pid on a fixture desk with a `stopped` ending and exit 143.
- Board: the row of a claimed slice whose worker is dead carries the Restart action, asserted on the domain property.
- Gate: `controller-gate.test.mjs` refuses a bare `plot-dispatch.sh --restart` and allows it after the controller receipt; the receipt is spent on the restart path.
- Shell: `scripts/check-shell-lines.sh pr` reports fewer lines than the merge base on slice 1, and no more on slice 2.
- The 2026-10-27 reproduction: in a sandbox fleet, `plot-fleetctl.sh --stop` then `--start` restarts the stopped slice desk, and a slice stopped earlier with `plot-dispatch.sh --stop` stays stopped.
- `node skills/plot/scripts/board/plot-local-checks.mjs` and the commands it prints pass on each branch.

## Notes

- Overlap checked against `2026-08-27-a-stopped-worker-can-be-restarted` (Released) and `2026-10-09-no-controller-resumes-a-claimed-slice` (Released): both are delivered, and neither adds a controller action.
- 2026-10-27: amended after panel round 1 with Jan Wloka's decisions.

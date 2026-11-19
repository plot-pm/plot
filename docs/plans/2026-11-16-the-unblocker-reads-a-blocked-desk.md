# The unblocker reads a blocked desk as waiting

> fleetd's unblocker world reads a desk's worker state with no PR assumed, so a desk with an untagged `PLOT-BLOCKED` marker and a dead agent reads `waiting` and `unblockerDue` can start an unblocker.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** bug-fixes-2-35-0
- **Issue:** #3320
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3475 merged
- **Started:** 2026-11-16, Jan Wloka, `bug/the-unblocker-reads-a-blocked-desk`
- **Delivered:** 2026-11-17
- **Released:** 2026-11-19, v2.35.0

## Changelog

- fleetd starts an unblocker on a desk whose agent asked a question with `PLOT-BLOCKED` and then stopped.

## Motivation

`unblockWorldForRepo` asks `processes.workerState(worktree, true)` for each desk (`packages/fleet/src/server/entry/registryd-main.ts:1412`). The second argument is `hasPr` (`packages/domain/src/ports/processes.ts:74`), and `processReadingOf` passes it into `agentState` (`packages/domain/src/adapters/processes/processes-files.ts:373`). For an agent that exited 0 or is orphaned, `agentState` answers `taskState(readings.task)` (`packages/domain/src/rules/agent-state.ts:160-164`). `taskState` returns `finished` on `hasPr` before it reads the marker (`packages/domain/src/rules/task.ts:88-89`). So every dead desk reads `finished`, never `waiting`. `deskDeadFromWorkerState` turns `finished` into `{ dead: true }` (`packages/fleet/src/shared/auto-fixer.ts:165-176`). `unblockerDue` admits a start only on `why === 'waiting'` and refuses `not-waiting` otherwise (`packages/domain/src/rules/unblocker-due.ts`, the second check in `unblockerDue`).

The result: fleetd never starts an unblocker on a real desk. An agent that writes its own `PLOT-BLOCKED:` question and stops waits for a person, although the unblocker role exists to answer it. The wiring test hides the defect: it stubs the reader to return `waiting` and its comment states the cause, *"the world asks with `hasPr` set, and a real desk's task state reads `finished` whenever a PR is named"* (`packages/fleet/test/unit/registryd-main.test.ts:3307-3309`).

The `true` came in with `07631e73f` (*registryd: fleetd's tick runs the unblocker role*) and is still on `origin/main` at `5850be951`. PR #3319 moved the reader to `processesFiles` and kept the `true`.

## Design

### Approach

Change one argument in the fleet entry: `unblockWorldForRepo`'s `deskDead` asks `processes.workerState(worktree, false)`. The unblocker world has no PR fact for a desk, and `TaskReadings.hasPr` states the contract for that case: *"A caller that cannot know says `false`, and the tree then answers"* (`packages/domain/src/rules/task.ts:45-49`). With `false`, the reading for a dead desk follows the existing domain order:

- an exit 0 or an orphaned wrapper with a marker reads `waiting`, and `deskDeadFromWorkerState` answers `{ dead: false, why: 'waiting' }`;
- a live pid reads `running`, which answers `live` and refuses `not-waiting`;
- a non-zero exit reads `failed`, which answers dead and refuses `not-waiting`, as before.

The fix changes no domain rule, port or adapter. `unblockerDue` and `taskState` stay as they are. No shell/domain duplicate is involved, so no corpus row changes.

The fixer tick also passes `true` (`packages/fleet/src/shared/auto-fixer.ts:373`). That caller reads PR rows, so its `true` is a real fact, and this plan does not change it.

Replace the stub in the wiring test (`registryd-main.test.ts:3307-3311`) with a real desk read through the default `processesFiles`, so the test fails while the world passes `true`.

### Open Questions

- [x] None.

## Done when

| Claim | Check | Slice |
|---|---|---|
| A desk with an untagged `PLOT-BLOCKED` marker, a dead agent (pid not alive, exit 0) and an open PR for its branch makes `unblockerDue` answer `{ start: true }` through `unblockWorldForRepo` with the default `processesFiles` reader | `packages/fleet/test/unit/registryd-main.test.ts` › *"unblockWorldForRepo reads a blocked desk with a dead agent as waiting"*; fails on `main`, where `deskDead` answers `{ dead: true }` and `unblockerDue` answers `not-waiting` | Read the desk with no PR assumed |
| The same desk with a live agent pid makes `unblockerDue` answer `{ start: false, why: 'not-waiting' }` | `registryd-main.test.ts` › *"unblockWorldForRepo reads a blocked desk with a live agent as live"* | Read the desk with no PR assumed |
| The production wiring test reads the real desk, not a stubbed `waiting` reader | `grep -n "state: 'waiting' as const" packages/fleet/test/unit/registryd-main.test.ts` prints no line in the `unblockWorldForRepo and unblockPortsFor` block | Read the desk with no PR assumed |

## Slices

### Read the desk with no PR assumed

- `bug/the-unblocker-reads-a-blocked-desk` — `packages/fleet/src/server/entry/registryd-main.ts` (`unblockWorldForRepo` passes `false` to `workerState`, and its TSDoc names the no-PR read), `packages/fleet/test/unit/registryd-main.test.ts` (two real-desk tests, dead and live agent; the wiring test loses its `waiting` stub), and a changeset for `plot` (patch, `bumps: skills: plot: patch`) <!-- builds: unblockWorldForRepo reads a blocked desk with no PR assumed --> → #3480

## Notes

- Deliverable search for *"unblockWorldForRepo reads a blocked desk with no PR assumed"*: one hit, `unblockWorldForRepo` itself (`registryd-main.ts:1402`, `:1436`, `:3306`). That is the function this slice changes, not a duplicate. A search for *"unblocker desk state"* found no existing deliverable that reads a blocked desk for the unblocker.
- Found by the *Worker readings* slice of `desk-probes-in-domain` (PR #3319, sprint `desk-probes-and-liveness`).
- The rule `deskDead` (`packages/domain/src/rules/desk-dead.ts`) reads a marker before liveness and answers `waiting` for a live agent too. This plan does not use it, because #3320 asks that a live agent answers no start.

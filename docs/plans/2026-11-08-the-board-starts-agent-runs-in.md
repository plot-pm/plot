# The board starts agent runs in its own process tree

> `startBoardRun` starts the idea, implement, story, approve, deliver, reslice and interrogate agents as children of the board server, so a board stop or restart ends them. Only the fleet should start and supervise agents.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** ship-2-32-0
- **Issue:** #3274
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3275 merged
- **Started:** 2026-11-08, Jan Wloka, `bug/board-runs-outlive-the-board`
- **Delivered:** 2026-11-09
- **Released:** 2026-11-11, v2.32.0

## Changelog

- A board stop or restart no longer ends an agent run that the board started. The run starts outside the board's process tree, writes its own end into its run-state file, and the board reads that file after a restart.

Board impact: yes. The board's run-state files gain the run's pid and exit code; the routes and the page keep their behaviour.

## Motivation

Measured 2026-11-08 at 19:42: a board restart ended the `state-branch` implement run before it booked its brief (`the board exited with code 143 before the run ended`). The plan was dispatched again (issue #3274).

`DESIGN-process.md` §1 states that the board and fleet control are independent systems whose process trees share no edge. `startBoardRun` (`packages/board/src/server/board-run.ts`) breaks that rule. It runs a `claude -p` process or the SDK connector in the board's process group with no `detached`. The comment at `idea.ts:808-815` names the cost: a board stop or restart ends the run and the state file then reads `failed`.

Seven server modules call `startBoardRun` (grep on `origin/main` at `e93c6b8fd`):

| Route | Role | File |
|---|---|---|
| `POST /api/idea` | `idea` | `idea.ts` |
| `POST /api/implement`, `POST /api/dispatch` | implement | `implement.ts` |
| story routes | `story` | `story.ts`, `story-plan.ts` |
| `POST /api/approve` with an `Approve command` | `approve` | `approve.ts` |
| `POST /api/deliver` | `deliver` | `deliver.ts` |
| reslice and interrogate routes | `reslice`, `interrogate` | `reslice.ts`, `interrogate.ts` |

The fleet package already has its own `startBoardRun` (`packages/fleet/src/shared/board-run.ts`), used by `auto-deliver.ts`, `auto-design.ts` and `auto-verify.ts`. fleetd therefore already starts board-role runs for the auto-* roles. The open work is the request path from the board to fleetd, not a second runner.

## Design

### Scope

This plan is the interim fix for #3274, in sprint `ship-2-32-0`. It keeps the board as the process that starts these runs and makes each run outlive the board. The full move, in which the board records a request and only fleetd starts and supervises agents, belongs to story `nothing-changed-nothing-runs` beside its Phase 4 and is tracked on #3274. This plan does not build a request path, a fleetd change or a `fleet-not-running` refusal.

### Approach

- **The run leaves the board's tree.** `plot-boardctl.sh --stop` stops the board's whole descendant tree (pidfile root and every process whose parent chain reaches it). A `detached: true` child keeps the board as its parent and is still stopped. The run therefore starts through a wrapper that re-parents it, as `plot-dispatch.sh:1507` does for desk agents with a detached `nohup sh -c` wrapper: the board's direct child exits at once, and the run's parent becomes `launchd`/init.
- **The wrapper records the end.** The wrapper writes the run's pid into the run-state file at start, waits for the run, and writes the exit code and end time into the same file at the end, atomically. The board no longer learns a run's end from its own `child.on('exit')`.
- **The board reads the file after a restart.** A state file that reads `running` with a live pid stays `running`. A state file that reads `running` with a dead pid and no exit record reads `failed`, with the reason `the run ended without an exit record`. The liveness check is the pid plus its start time, as `plot-worker-state.sh` reads a desk worker today.
- **Where it changes.** The spawn site is an adapter: `agent-run-command.ts` reaches `bounded-run-process.ts`, whose child is never detached by design (`bounded-run-process.ts:148`, so a bounded kill reaches the whole group). Board runs get their own detached start in the `agent-run` adapter; `bounded-run-process.ts` and its callers keep their behaviour. The domain decides what a state file means (`running`, `done`, `failed`, and the dead-pid rule) as a pure rule with unit tests.
- **The SDK connector.** `agent-run-sdk.ts` runs in-process when `runnerChoice` picks `sdk` for a role. An in-process run cannot outlive the board. For a role on the `sdk` connector, the board keeps today's behaviour, and the route's state file says `in-board` so the page and the log name the cost. The full move on #3274 removes this case.

### Settled Questions

- The wrapper is a shell launcher next to the existing dispatch wrapper, not new Node code in the board server: re-parenting needs a process that exits before the run does, and the dispatch wrapper already does that on both macOS and Linux.
- Runs started by an older board before this change ship keep their old behaviour. Their state files carry no pid, so the board reads them as today.

### Left to the Builder

- The field names for pid, start time, exit code and end time in the run-state file.
- Whether the wrapper reuses `plot-dispatch.sh`'s wrapper function or a small shared launcher; `scripts/check-shell-lines.sh` counts the shell either way.

## Slices

### Runs outlive the board

- `bug/board-runs-outlive-the-board` — board-started runs start through a re-parenting wrapper, write their pid and exit record into the run-state file, and the board reads a dead pid with no exit record as `failed`. A test starts a stub run through the idea route, stops the board's process tree as `plot-boardctl.sh --stop` does, and asserts the stub run keeps going and books its exit code. <!-- builds: the detached board-run start and the run-state end record --> → #3290

## Notes

- Source: issue #3274. Related: `docs/stories/nothing-changed-nothing-runs` Phase 4 (the board reads fleetd's snapshot); this plan is the write-side counterpart.
- Done when, from the issue: a board stop during an idea or implement run leaves the run going and the run books its result; a test asserts every role reaches fleetd through one request path; with no fleetd a route refuses `fleet-not-running` or the plan states the fallback.
- Existing plan `2026-11-01-the-board-starts-processes-on-the` is Released and concerns `GET /api/board` process starts; it is a different subject.

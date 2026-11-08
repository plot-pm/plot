# The board starts agent runs in its own process tree

> `startBoardRun` starts the idea, implement, story, approve, deliver, reslice and interrogate agents as children of the board server, so a board stop or restart ends them. Only the fleet should start and supervise agents.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #3274
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- A board stop or restart no longer ends an agent run. The board records the request (action, subject, requester) and returns; fleetd starts, supervises and records the end of the run, and the board reads the run's state like every other fleet state.
- A board route that needs fleetd refuses with `fleet-not-running` when no fleetd runs, and starts nothing.

Board impact: yes. The controller routes change what they do after the request is recorded; the run-state files the board reads keep their shape unless a slice says otherwise.

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

### Approach

The board writes a request record and returns 202. fleetd reads the record on its tick, starts the run through the fleet's `startBoardRun`, and writes the run's state file. The board reads that state file as it does today.

- **One request path.** Every role in the table reaches fleetd through one function in the board package. A test asserts that no board module outside that function imports `startBoardRun` or reaches `agentRun`.
- **Request record.** Holds the action, the subject (slug or branch), the requester and the time. The record is a file under `.plot/state/`, written atomically; the exact shape is a slice decision.
- **No fleetd.** The route reads the fleetd heartbeat. With no live heartbeat it answers `fleet-not-running`, records nothing and starts nothing. A fallback that keeps board-started runs is allowed only if a slice states it and its reason.
- **Layering.** The board is a controller: it calls the domain, and the domain owns the port for "request a run". The adapter writes the request file. Domain behaviour (what a request names, when it is refused) is unit-testable without a browser.

### Open Questions

- [ ] Does the request live as a file fleetd polls, or as an HTTP call to fleetd? The file matches "the board is a pure reader" in `nothing-changed-nothing-runs` Phase 4 and needs no new listener.
- [ ] Which routes return a result the page waits on? A synchronous answer (for example `idea` returning a PR URL) may need a poll on the run-state file instead.
- [ ] Is a `fleet-not-running` refusal acceptable for every role, or does one role (an operator-only `approve`) keep a fallback?
- [ ] Do runs in flight at the deploy of this change finish under the old board process, and how does the state file tell the two owners apart?

## Slices

### Tracer

- `feature/the-board-requests-an-idea-run` — `POST /api/idea` records a request, fleetd starts the idea run, a board restart leaves the run going. <!-- builds: boardRunRequest, the one board-to-fleetd request path -->
  Layers: board route → domain request rule → request adapter → fleetd tick → fleet `startBoardRun`
  Proves: the request path and the `fleet-not-running` refusal end to end for one role.

### Implementation

- `feature/the-board-requests-implement-and-dispatch-runs` — `implement.ts` and the dispatch route use the request path. <!-- waits: the-board-requests-an-idea-run -->
- `feature/the-board-requests-story-runs` — `story.ts` and `story-plan.ts` use the request path. <!-- waits: the-board-requests-an-idea-run -->
- `feature/the-board-requests-approve-deliver-reslice-interrogate-runs` — the four remaining modules use the request path, and a test asserts that no board module reaches `startBoardRun` or `agentRun`. <!-- waits: the-board-requests-an-idea-run -->

## Notes

- Source: issue #3274. Related: `docs/stories/nothing-changed-nothing-runs` Phase 4 (the board reads fleetd's snapshot); this plan is the write-side counterpart.
- Done when, from the issue: a board stop during an idea or implement run leaves the run going and the run books its result; a test asserts every role reaches fleetd through one request path; with no fleetd a route refuses `fleet-not-running` or the plan states the fallback.
- Existing plan `2026-11-01-the-board-starts-processes-on-the` is Released and concerns `GET /api/board` process starts; it is a different subject.

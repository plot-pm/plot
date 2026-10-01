# A handed slice reads as taken

> Between the registry handing a slice to an agent and the agent taking it up, the slice's row reads `approved — nobody has taken it` in NOT STARTED while WORKING lists the agent on that branch. The row reads the scan; WORKING reads the registry. The row must read the hand-over too.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #1150
- **Sprint:** the-fleet-runs-through-its-limits
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A slice that the registry has handed to a live agent reads as taken, in WORKING, with the agent named, from the hand-over until the agent's own worker is visible on the branch.
- A claim that no live agent holds still reads as before: NOT STARTED within the quiet window, then WAITING ON YOU as an orphaned claim (#1090).

Board impact: one row rule and one note. No plan-format, template or script change.

## Motivation

Measured 2026-10-01 on `localhost:7777`, on this sprint's own slices:

- WORKING listed agent `334b3492` on `bug/the-rule-names-a-usage-limit`, from its manifest. The same slice's row in NOT STARTED read `eligible · approved — nobody has taken it · 0m`, with the agent's activity dot beside it. The same held for `bug/a-closed-sprint-stops-filtering` and `bug/the-merge-subject-is-one-rule`.
- Minutes later, with a 2 s old payload read at `4b603822`, four of the five slices read `working · worker running (pid …)`, including the empty claim `bug/the-tally-names-its-tickets`. So the server's rule is right once the scan sees the agent's worker in the worktree that holds the branch.

**The rows contradict each other in a window, and the window is long.** A free agent reads its manifest once every 60 s (`plot-worker-loop.sh`, *"reading the manifest every 60s"*). Until it reads it, its desk is still on the previous branch or detached. The scan finds a branch's worker through the worktree list (`worker_of`, `plot-fleet-scan.sh:1936`): no worktree holds the branch, so it answers `elsewhere`. `classifyGroup` (`packages/board/src/server/fleet.ts:4096`) then reads the branch as `open` or `claimed` with no known worker:

- `open` with no local activity and verdict `eligible` returns `{ group: 'not-started', note: ELIGIBLE_NOTE }` (`fleet.ts:4787`).
- `claimed` within the quiet window returns `{ group: 'not-started', note: 'claimed elsewhere' }` (`fleet.ts:5053-5054`).

The client renders a sole row's empty note as the verdict sentence `approved — nobody has taken it` (`packages/board/src/app/lib/agent-rows/rows.tsx:1092`).

The registry already knows the answer. `refresh` reads the manifests into `entry.agents` (`fleet.ts:3210-3214`), and each `AgentEntry` carries the `branch` the registry handed it, its `session` and its `state` (`packages/board/src/contract/schema.ts:3527`). Rows are built from the pulse alone (`rowsFromPulse`, called at `fleet.ts:7790`), so that fact never reaches a row.

**What this does not change.** `classifyGroup`'s worker arms stay as they are: `running` and `waiting` read from the desk outrank everything except a failing PR (`fleet.ts:4859`). The `claimed` arm's orphan rule (`fleet.ts:5059-5089`) stays: a claim that no live agent holds is still somebody's to answer. #1090's reading stays: an empty claim is not merged and not delivered.

## Design

### A rule names the agent the registry handed a branch to

A new pure rule, `handedTo`, in `packages/domain/src/rules/handed-to.ts`:

```ts
export interface HandedReading {
  readonly session: string;     // the agent's registry session (AgentEntry.session)
  readonly state: string;       // the agent's process state, as AgentEntry carries it
  readonly branch: string;      // the branch its manifest names, '' when free
}

/** The session of the live agent the registry handed `branch` to, or '' when none. */
export const handedTo = (branch: string, agents: readonly HandedReading[]): string => …
```

It answers a session only for an agent whose `state` is `running` and whose `branch` equals `branch`. It answers `''` for an empty `branch`, for no match, and for a match whose state is not `running`. Two live agents naming one branch is the double hand-out #1039 and #1152 describe, so the rule answers `''` and does not choose between them: the row then reads as it does today, and the WORKING section still shows both agents.

`running` only, because `waiting` already reaches the row from the desk (`fleet.ts:4862`), and every stopped state means nobody is on the branch now.

### The row reads the rule after the scan

A new board function, `withHandOver(rows, agents)`, in `packages/board/src/server/fleet.ts` beside `rowsFromPulse`, runs at the call site (`fleet.ts:7790`) where `entry.agents` is in scope. For each row whose `group` is `not-started` and whose `worker` is not `running` or `waiting`, it asks `handedTo(row.branch, agents)`. Where the rule answers a session, the row becomes:

- `group: 'working'`
- `note: 'handed to agent <first 8 characters of the session> — not taken up yet'`, the form WORKING already prints

Every other field stays. A row in any other group is never moved: a PR, a failure, a draft plan, a finished plan and a blocked slice each keep their answer, because each of those is a fact the hand-over does not change.

**Why after the scan and not inside `classifyGroup`.** `classifyGroup` takes the scan's readings for one branch, and the registry is not one of them. Threading `entry.agents` through `rowsFromPulse` and into `classifyGroup`'s 30-parameter list would add a positional argument to a list whose own comments record six tests broken by one insertion (`fleet.ts:4196-4202`). The rewrite reads one more reading at the place it already exists.

### The label

The note names the agent and the state, `handed to agent 334b3492 — not taken up yet`, and never `someone is on it`: the agent has not checked the branch out, and the reader's next question, *which agent*, is answered by the session prefix WORKING shows. When the agent takes the branch up, the scan sees its worker and the row reads `worker running (pid …)` from `classifyGroup` as today, so the note changes once and the group does not move.

## What this does NOT do

- **It does not fix the queue.** The supervisor handing out a second slice before the first (#1100), a release racing the hand-over (#1152) and a leftover checkout holding a branch (#1151) are separate defects. This plan only makes the row say what the registry already says.
- **It does not change the scan or any script.** The registry is read by the board today; the scan stays git-only.
- **It does not change `classifyGroup`.** The orphan rule and the worker arms are untouched.

## Done when

- `handedTo` has unit cases in `packages/domain/test/handed-to.test.ts` for: a running agent naming the branch (its session); a free agent (`''`); a non-running agent naming the branch (`''`); two running agents naming one branch (`''`); an empty branch (`''`). Domain branch coverage stays at 100%.
- A board unit test drives `withHandOver` with a `not-started` row and a matching running agent and asserts `group: 'working'` and the note; with a row in `waiting-on-you`, `done` or `quiet` and the same agent, it asserts the row is unchanged; with a row whose `worker` is `running`, it asserts the row is unchanged.
- One browser test serves a fleet payload with an empty-claim row in `not-started` and an `agents` entry that names its branch with state `running`, and asserts the row renders in WORKING with the agent's session prefix in its note and without the text `nobody has taken it`. `EXPECTED_TESTS` in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` rises by 1 over the value on `origin/main` when the slice lands (536 at `4b603822`; the #1145 plan raises it by 2, so the order of merge decides the final number).
- A `'@plot-pm/board': patch` changeset; the domain rule needs no package entry of its own beyond what the board bundles.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` and `pnpm run typecheck` pass. `pnpm run test:e2e` is CI's.

## Slices

### The row reads the hand-over (Branch: bug/the-row-reads-the-hand-over)

`handedTo` and its tests, `withHandOver` at the `rowsFromPulse` call site and its unit test, the browser test and the count pin, and the changeset.

## Notes

**Found 2026-10-01** while the fleet started this sprint's first slices: the operator asked how a NOT STARTED slice can carry an active agent. The live payload then showed the window closing on its own once each agent took its branch up, which is why the fix is a reading of the registry rather than a change to the classifier.

**Two earlier plans touched this wording.** `a-claimed-slice-does-not-say-nobody-took-it` (Released) made the sentence read the row's own startability rather than the wave's verdict. `a-claimed-slice-is-somebody-s` was rejected. Neither read the registry, because the registry did not hand out slices when they were written.

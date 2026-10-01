# A handed slice reads as taken

> Between the registry handing a slice to an agent and the agent taking it up, the slice's row reads as nobody's in NOT STARTED, or as an orphaned claim in WAITING ON YOU, while WORKING lists the agent on that branch. The row reads the scan; WORKING reads the registry. The row must read the hand-over too.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #1150
- **Sprint:** the-fleet-runs-through-its-limits
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- A slice that the registry has handed to one live agent reads as taken, in WORKING, with the note `handed over — not taken up yet`, from the hand-over until the agent's own worker is visible on the branch. This holds inside the quiet window and after it.
- A slice that the registry has handed to two live agents at once reads in WAITING ON YOU with the note `handed to 2 agents at once`.
- A claim that no live agent holds still reads as before: NOT STARTED within the quiet window, then WAITING ON YOU as an orphaned claim (#1090).

Board impact: one row rule and two notes. No plan-format, template or script change.

## Motivation

Measured 2026-10-01 on `localhost:7777`, on this sprint's own slices:

- WORKING listed agent `334b3492` on `bug/the-rule-names-a-usage-limit`, from its manifest. The same slice's row in NOT STARTED read `eligible · approved — nobody has taken it · 0m`, with the agent's activity dot beside it. The same held for `bug/a-closed-sprint-stops-filtering` and `bug/the-merge-subject-is-one-rule`.
- Minutes later, with a 2 s old payload read at `4b603822`, four of the five slices read `working · worker running (pid …)`, including the empty claim `bug/the-tally-names-its-tickets`. So the server's rule is right once the scan sees the agent's worker in the worktree that holds the branch.

**The rows contradict each other in a window, and the window is long.** A free agent reads its manifest once every 60 s (`plot-worker-loop.sh`, *"reading the manifest every 60s"*). Until it reads it, its desk is still on the previous branch or detached. The scan finds a branch's worker through the worktree list (`worker_of`, `plot-fleet-scan.sh:1936`): no worktree holds the branch, so it answers `elsewhere`. `classifyGroup` (`packages/board/src/server/fleet.ts:4096`) then reads the branch as `open` or `claimed` with no known worker:

- `open` with no local activity and verdict `eligible` returns `{ group: 'not-started', note: ELIGIBLE_NOTE }` (`fleet.ts:4787`). `ELIGIBLE_NOTE` is `'eligible — nobody has taken it'` (`packages/board/src/contract/schema.ts:1563`).
- `claimed` within the quiet window returns `{ group: 'not-started', note: 'claimed elsewhere' }` (`fleet.ts:5053-5054`). The client blanks that note, because a claimed row's startability is `someone-is-on-it` (`startableNote`, `packages/board/src/app/lib/agent-rows/rows.tsx:1521`).
- `claimed` past the quiet window (30 minutes, `fleet.ts:102`) with no local activity returns `group: 'waiting-on-you'` with the orphaned-claim note, for example `claimed, no work committed — claimed 45 min ago · claimed elsewhere` (`fleet.ts:5059-5096`). Measured by the round-1 skeptic with a scratch test over `rowsFromPulse` at `5da3e923`.

The words `approved — nobody has taken it` are NOT STARTED's section hint (`packages/board/src/app/lib/agent-rows/sections.ts:43`). A sole row renders its own note (`rows.tsx:1088`, the `soleRow ? soleNote` arm), so the verdict sentence at `rows.tsx:1092` never reaches it.

The registry already knows the answer. `refresh` reads the manifests into `entry.agents` (`fleet.ts:3214`), and each `AgentEntry` carries the `branch` the registry handed it, its `session` and its `state` (`schema.ts:3537`, `:3556`, `:3612`). Rows are built from the pulse alone (`rowsFromPulse`, called only at `fleet.ts:7790`), so that fact never reaches a row.

**What this does not change.** `classifyGroup` stays as it is: its worker arms, its orphan rule and its Draft rule each keep their answer, and this plan rewrites rows after it. #1090's reading stays: an empty claim is not merged and not delivered, and a claim that no live agent holds is still somebody's to answer.

## Design

### A rule names the agents the registry handed a branch to

A new pure rule, `handedTo`, in `packages/domain/src/rules/handed-to.ts`:

```ts
export interface HandedReading {
  readonly session: string;     // the agent's registry session (AgentEntry.session)
  readonly state: string;       // the agent's process state, as AgentEntry carries it
  readonly branch: string;      // the branch its manifest names, '' when free
}

/** The sessions of the live agents the registry handed `branch` to, sorted; empty when none. */
export const handedTo = (branch: string, agents: readonly HandedReading[]): readonly string[] => …
```

It returns the session of every agent whose `state` is `running` or `waiting` and whose `branch` equals `branch`, sorted. It returns `[]` for an empty `branch` and for no live match.

`running` and `waiting`, because those two are `LIVE_STATES` (`schema.ts:3407`), and `workingAgentRows` (`packages/board/src/app/lib/agent-rows/working-agents.ts:40-55`) puts exactly those agents in WORKING. The row then agrees with the section its agent appears in. Every other state means no worker is on the branch now.

The rule takes readings as values and decides nothing about sections. The section decision stays in board code, in `withHandOver`, because `group` and `note` are the board's contract. That split is deliberate, and a unit test asserts both halves without a browser.

### The row reads the rule after the scan

A new board function, `withHandOver(rows, agents)`, in `packages/board/src/server/fleet.ts` beside `rowsFromPulse`, runs at the call site (`fleet.ts:7790`) where `entry.agents` is in scope. A row is a candidate when all of these hold:

- its `worker` is not `running` or `waiting`;
- its `verdict` is not `unapproved`;
- it is either in `not-started`, or it is the orphaned claim: `state === 'claimed'`, `group === 'waiting-on-you'` and `pr === null`.

For a candidate it asks `handedTo(row.branch, agents)`:

| sessions | result |
|---|---|
| none | the row is unchanged |
| one | `group: 'working'`, `note: 'handed over — not taken up yet'`, `startability: 'someone-is-on-it'` |
| two or more | `group: 'waiting-on-you'`, `note: 'handed to <n> agents at once'`, `startability: 'someone-is-on-it'` |

Every other field stays. A row in any other group is never moved: a PR, a failure, a finished plan and a blocked slice each keep their answer, because the hand-over does not change those facts.

**Startability.** Every moved row carries `someone-is-on-it`, so `isStartable` and the menus offer no start on a row an agent holds. An `open` row otherwise keeps `start-work` from `startabilityVerdict`.

**Why after the scan and not inside `classifyGroup`.** `classifyGroup` takes the scan's readings for one branch, and the registry is not one of them. Threading `entry.agents` through `rowsFromPulse` and into `classifyGroup`'s 30-parameter list would add a positional argument to a list whose own comments record six tests broken by one insertion (`fleet.ts:4196-4202`). The rewrite reads one more reading at the place it already exists.

The plan adds no payload field, so the client's cast of the fleet needs no schema change.

### The note

The note format is new: `handed to agent` and `not taken up` occur nowhere in `packages/board/src` today. WORKING renders registry agents, not branch rows (`workingAgentRows` at `packages/board/src/app/components/AgentList.tsx:462`, rendered through `RegistryRow` at `:1460`): the moved row is not drawn itself, and its note appears under the agent's `RegistryRow` (`rows.tsx:2450`), beside a link that already shows the agent's session (`rows.tsx:2383`). So the note names the state and not the session: `handed over — not taken up yet`. When the agent takes the branch up, the scan sees its worker and the row reads `worker running (pid …)` from `classifyGroup` as today, so the note changes once and the group does not move.

### The four cases a reader meets

| case | readings | group | note |
|---|---|---|---|
| A held claim past the quiet window | `claimed`, 45 min, one `running` agent names the branch | WORKING | `handed over — not taken up yet` |
| An agent that dies with an empty claim | `claimed`, the agent's state turns `failed` or `stalled` | the row returns to `classifyGroup`'s answer: NOT STARTED `claimed elsewhere` within the window, WAITING ON YOU orphaned claim after it | unchanged. `brokenAgentRows` (`working-agents.ts:80`) also shows the agent in WAITING ON YOU. Two rows then name the branch, each with a different true fact: the claim needs an answer, and the agent stopped |
| Two agents handed one branch | two live agents name the branch | WAITING ON YOU | `handed to 2 agents at once`. Both agents still show in WORKING. The queue defect that causes it is #1039 and #1152; this row only reports it |
| An agent in `waiting` | one `waiting` agent names the branch, its desk does not hold it | WORKING | `handed over — not taken up yet` |

### Open worker log

`showsWorkerLog` reads the group only (`packages/board/src/app/lib/agent-rows/menus.tsx:68`), so a handed row offers "Open worker log". This plan does not change that. Until the agent checks the branch out, `/api/worker-log` answers the existing miss reason `no-worktree` (`packages/board/src/server/worker-log.ts:64`), which is true: no worktree holds the branch yet.

### The order with #1161

`a-draft-slice-waits-on-its-approval` (#1161, `docs/plans/2026-10-02-a-draft-slice-waits-on-its-approval.md`) places a Draft plan's `open`, `blocked`, `waiting`, `unknown` and `deferred` branch in WAITING ON YOU with `plan not approved yet — still in review`, and leaves `claimed` to the `claimed` arm. **For a Draft plan's slice that an agent holds, the Draft rule wins.** `withHandOver` skips every row whose `verdict` is `unapproved` (`packages/domain/src/rules/eligible.ts:107`), whatever its group. Dispatch refuses a Draft plan's slice, so a live agent on one is a fault in its own right, and the row must keep naming the approval a person owes. The agent still shows in WORKING. A live worker that the scan sees on the branch still reads WORKING from `classifyGroup`, as #1161 allows. Whichever plan merges second rebases onto the other and re-runs `pnpm run test:board`.

## What this does NOT do

- **It does not fix the queue.** The supervisor handing out a second slice before the first (#1100), a release racing the hand-over (#1152), a double hand-out (#1039) and a leftover checkout holding a branch (#1151) are separate defects. This plan only makes the row say what the registry already says.
- **It does not change the scan or any script.** The registry is read by the board today; the scan stays git-only.
- **It does not change `classifyGroup` or the menus.**

## Done when

- `handedTo` has unit cases in `packages/domain/test/handed-to.test.ts` for: a `running` agent naming the branch (its session); a `waiting` agent naming the branch (its session); a free agent (`[]`); a `failed`, `stalled`, `finished` and `ended` agent naming the branch (`[]`); two live agents naming one branch (both sessions, sorted); an empty branch (`[]`). Domain branch coverage stays at 100%.
- A board unit test drives `withHandOver` and asserts:
  - a `not-started` row and one matching `running` agent: `group: 'working'`, `note: 'handed over — not taken up yet'`, `startability: 'someone-is-on-it'`;
  - an orphaned-claim row (`claimed`, `waiting-on-you`, `pr: null`, `ageMinutes: 45` against a 30-minute window) and one matching `running` agent: the same three fields;
  - a `not-started` row and one matching `waiting` agent: the same three fields;
  - a `not-started` row and two matching live agents: `group: 'waiting-on-you'`, `note: 'handed to 2 agents at once'`;
  - #1090's rule holds: a `not-started` row with no agent on its branch, an orphaned-claim row with no agent on its branch, and a `not-started` row whose matching agent is `failed` or `finished` are each unchanged;
  - a row with `verdict: 'unapproved'` and a matching `running` agent is unchanged;
  - a row in `done` or `quiet`, a `claimed` `waiting-on-you` row with a PR, and a row whose `worker` is `running`, each with a matching agent, are unchanged.
- One browser test serves a fleet payload in which the empty-claim row already carries `group: 'working'` and the note, with an `agents` entry that names its branch with state `running`. It asserts that the `[data-agent-row]` note cell for that agent reads `handed over — not taken up yet` and that NOT STARTED holds no row for the branch. **It proves rendering only**: the server rule is proved by the unit test above. `EXPECTED_TESTS` in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` is the value at rebase + 1 (538 at `385d6d7d`).
- A `'@plot-pm/board': patch` changeset; the domain rule needs no package entry of its own beyond what the board bundles.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` and `pnpm run typecheck` pass. `pnpm run test:e2e` is CI's.

## Slices

### The row reads the hand-over (Branch: bug/the-row-reads-the-hand-over)

`handedTo` and its tests, `withHandOver` at the `rowsFromPulse` call site and its unit test, the browser test and the count pin, and the changeset.

## Notes

**Found 2026-10-01** while the fleet started this sprint's first slices: the operator asked how a NOT STARTED slice can carry an active agent. The live payload then showed the window closing on its own once each agent took its branch up, which is why the fix is a reading of the registry rather than a change to the classifier.

**Two earlier plans touched this wording.** `a-claimed-slice-does-not-say-nobody-took-it` (Released) made the sentence read the row's own startability rather than the wave's verdict. `a-claimed-slice-is-somebody-s` was rejected. Neither read the registry, because the registry did not hand out slices when they were written.

**Round 1 (2026-10-02)**, unanimous amend: `.plot/panels/2026-10-01-a-handed-slice-reads-as-taken/round1.md`.

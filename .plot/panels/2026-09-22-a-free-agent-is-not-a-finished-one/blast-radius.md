# Blast radius — a free agent is not a finished one

Position: reject

## The lens

`plot-worker-state.sh` calls itself *the ONE answer*. It is sourced by five scripts, and its word crosses into a **zod enum**, a **domain rule**, a **corpus test** and **four `=== 'running'` gates**. The plan's slice says the change leaves *"every other arm unchanged"*. That claim is about the producer. Tested against the consumers, it is false in six places, three of which are silent.

---

## 1. Does the stated problem exist?

**The mechanism is real. The reading the plan took is not the one it reported, and the population it names is narrower than the plan thinks.**

Verified in the code:

- `plot-worker-state.sh:863` asks `plot_worker_agent_alive` on a live wrapper, and `:866` routes a definite absence (`rc=1`) to `plot_worker_task_state`. A clean desk there answers `finished`. A free agent's desk IS clean by construction. So the route to `finished` exists exactly as described.
- `agentState` in `packages/domain/src/rules/agent-state.ts:139` does the same: `liveness === 'orphaned'` → `taskState(...)` → `finished`.

Measured on the very desk the plan cites, `.worktrees/free-1146d4ff`, pid 1794:

```
state: running	1794
```

It reads `running` NOW, because the supervisor handed it `feature/the-store-holds-what-the-host-said` and a `claude` child exists. The plan's own postscript records the same repair. **So the whole observation window is the gap between `--start` and the supervisor's next tick** — which on a healthy daemon is 60 s, and which was hours only because the daemon was dead. The plan itself diagnoses the dead daemon and then fixes the state word anyway.

Also verified: `/api/fleet agents: 0` is NOT caused by `finished`. `dropSettledWorkers` (`registry.ts:947`) drops an entry only when it is non-running **and** `cleanliness` says the desk is clean, and cleanliness is **opt-in** — `defaultCleanliness` drops nobody. The board does enable it in `fleet.ts`. So the drop is real, but it is gated on *clean desk*, which a free desk is and always will be, whatever word the state carries — see §4.

**The premise half holds; the "so the board drops it" half is one inference too far.**

---

## 2. Is it the smallest change?

**No. A smaller change already exists, built, exported and unit-tested, and the plan does not mention it.**

`packages/domain/src/rules/free.ts` — `isAgentFree`:

```ts
export const isAgentFree = (reading: AgentReading): boolean => {
  if (reading.state !== 'running') return false;
  return reading.branch === '' || reading.sliceHasMerged;
};
```

Its own docstring answers the plan's design section almost word for word: *"`running` is not busy. An agent between slices is running with no branch and is available."* And `packages/board/src/app/lib/tuple-row.ts:960` already renders the literal string `free` from it.

`plot-worker-loop.sh:326` states the same discriminator the plan calls new:

> `free = process alive AND manifest names no branch`

and `clear_manifest_branch` exists specifically to make that arm reachable in production.

**The estate already decided this question, and decided it the other way**: *free* is a **derived availability label** computed from `state + branch`, deliberately NOT a state. `tuple-row.ts:945` says why, and it is the Layering Rule's own example:

> A SEPARATE FUNCTION RATHER THAN A WIDER `agentStateStatus`, because the two answer different questions from different inputs. … there is no word that says both.

The plan proposes making `free` a state, which collapses exactly the split that file argues for — without citing it.

---

## 3. What could I not verify?

- **That a free agent is the population being dropped at all.** No current desk on this machine reads `finished` with `branch: ""`; the one manifest here names a branch. The plan's single measurement is from a session with a 15-hour-dead daemon and a 131 MB log.
- **That the board is where a free agent should appear.** The plan's own Notes defer that (*"which section is the board's question and not this plan's"*) — and §4 shows the state word does not get it there.
- **Whether the `free` state would survive the corpus test at all.** I did not run `pnpm run test:board` (load), but the assertions are read below and two of them are unconditional.

---

## 4. What breaks if this ships as written?

Six consumers, in descending severity.

### 4.1 The queue stops handing work to free agents — the exact opposite of the goal

`rules/queue.ts:249`:

```ts
const free = readings.agents.filter((agent) => isAgentFree(agent.reading));
```

and `isAgentFree` returns `false` for any state that is not `running`. A desk answering `free` is **filtered out of the free list**. `matchQueue` is the supervisor's assignment lock; `plot-registryd.mjs` derives the queue and matches it every tick.

`whyNotFree` would then print, for a free agent: **`not running — free`**.

`auto-dispatch.ts:220` reads `isFree` (the entity wrapper over the same rule) and would stop counting free agents entirely, so `--start [N]`'s fill and the `Parallel agents` cap both mis-read.

**A plan whose stated goal is "an operator who started agents sees them appear" would, as written, make the started agents undispatchable.** This is not a rendering regression; it is the fleet's core assignment path.

### 4.2 The corpus test fails on three separate assertions, and the contract forbids fixing it

`packages/domain/corpus/agent-state.corpus.test.ts` is a declared shell↔rule pair under `docs/shell-and-domain.md`. On a shell-only change:

1. `answers what the shell answers, on every desk` — `agentState(readings)` returns `finished`, shell returns `free`. Disagreement.
2. `compares states both sides can actually name` — asserts every answered state is in `AgentStateSchema.options`. `free` is not.
3. `agrees on the desks that are alive right now` —

```ts
const live = desks.filter((d) => d.readings.split('\t')[2] === 'live');
for (const desk of live) {
  expect(agentState(readingsFrom(desk.readings))).toBe('running');
  expect(desk.state).toBe('running');
}
```

A free agent's wrapper answers `kill -0`, so its liveness reading is `live`. **This test hard-asserts that every live desk reads `running` on both sides** — the precise claim the plan overturns.

CLAUDE.md's rule on this pair: *"On a disagreement the branch stops; adjusting either side to make the comparison pass is the one move forbidden."* The slice as written walks straight into that and has no escape.

### 4.3 The two schemas refuse the word, and the board silently rewrites it

`entities/fleet.ts:122` `WorkerStateSchema` and `entities/agent.ts:15` `AgentStateSchema` are `z.enum`s of eight. `registry.ts:56`:

```ts
export const KNOWN_STATES = new Set(AgentStateSchema.options.filter((s) => s !== 'unknown'));
```

An unknown word from the shell becomes **`unknown`**. So the board would render the free agent as `unknown` — which `isBrokenState` classifies as **BROKEN**, filing it in WAITING ON YOU as a problem report. The plan's goal is a calm visible row; the delivered result is a false alarm.

`packages/board/test/unit/schema.test.ts:291` pins `toHaveLength(9)` and `:479` pins the domain's `toHaveLength(8)`, so widening the enums is itself a deliberate, tested act — not a free extension.

### 4.4 `isLiveState` is a denylist and fails toward visibility — so a widened enum is a second, separate change

`schema.ts:3256` `NOT_LIVE_STATES` is a literal seven-member set; `isLiveState` is its complement. Add `free` to `AgentStateSchema` and **do not** add it to `NOT_LIVE_STATES`, and `free` reads as **live** — so a free agent renders in WORKING, which the plan's Notes explicitly say it must not (*"a free agent is not working"*). `schema.test.ts:492` names this exact hazard as measured, from when four states were added on 2026-09-04.

So: widen one enum and the agent is a broken problem report; widen two and it is in WORKING. Neither is what the plan asks for. The section it actually wants does not exist, and the plan defers deciding it.

### 4.5 `--restart` and `--stop` gain a silent wrong answer

`workflows/dispatch-verbs.ts`:

- `stopWorker:114` — `const signalling = state === 'running';`. A `free` worker reads **not signalling**, so `--stop` on a free agent decides *no writes* and reports it stopped while its loop keeps running for the whole `Worker bound` (28800 s). `plot-fleetctl.sh --stop` orchestrates `plot-dispatch.sh --stop` per dispatched agent — and a free agent holds no branch, so it is already reported-and-left; this makes the same silence reachable through the named branch too.
- `restartWorker:381` — `if (state === 'running') return 'worker-alive';` guards against replacing a live worker. **A `free` state passes that guard**, then falls through to `decide('worker-start', ...)`. `--restart` would launch a second worker into a desk whose loop is alive. There is deliberately no `--force` here *because* the live-worker refusal is the safety property; this defeats it by routing around the word it tests.
- `migrationRefusal:381` — same shape: `--migrate` refuses on `state === 'running'`. A `free` desk becomes movable **while its loop is running inside it**.

None of these is caught by a type error, because the field is typed `WorkerState` and the shell's word arrives as a string.

### 4.6 `plot-reap.sh` — checked, and it is the one consumer that holds

The reaper's `liveWorker` reading is `readings.workerPid !== null && readings.workerPid !== ''` (`reapable.ts:441`) — a **pid**, not a state word. A free desk keeps its `.plot-worker.pid`, so `liveWorker` still refuses. It also requires a merged PR, which a free desk has none of.

**So a `free` desk does not become reapable.** That is the one place the plan's *"every other arm unchanged"* survives contact — and it survives by accident, because that consumer never reads the state word.

---

## 5. A nearer mechanism the plan ignored

Three, in order of nearness:

1. **`isAgentFree` / `agentAvailability`** — already derives `free` from `state + branch`, already renders the literal word on a board row, and already carries the argument for why it is a second question rather than a ninth state. The plan's own discriminator table is this rule's docstring.
2. **`clear_manifest_branch` (`plot-worker-loop.sh:323`)** — written on 2026-09-02 to make `isFree`'s empty-branch arm reachable, with the measurement *"2 manifests on this estate, neither ever carrying `branch: \"\"`"*. The plan asserts `branch: ""` is present *by construction* at `--start`; it does not check whether the board's registry then reads it through `isFree`.
3. **`WorkerActivitySchema` (`entities/fleet.ts:157`)** — the estate's established pattern for *"a cue on `running`, deliberately not a ninth state"*, added for a case with the same shape: distinguishing kinds of `running` without touching the enum. The plan proposes a ninth state and never argues against the precedent the repo set for exactly this.

The plan does not mention any of the three. Its `free` is presented as a new word; three components already spell it, and one of them spells it as the thing the plan says it must not be.

---

## Why reject rather than amend

An amendable plan would be one whose slice is right and whose blast radius needs widening. This one's **stated remedy inverts its stated goal** (§4.1) and its **single slice cannot be delivered green** (§4.2) — not because a test is inconvenient, but because the corpus contract forbids the only move that would make it pass.

What is worth keeping is the measurement and the postscript: the dead-daemon-under-a-loaded-label defect (`plot-fleetctl.sh --status` reads the LABEL, not the process) is real, unfixed, and by the plan's own account the reason the session took three wrong turns. That deserves the plan this one currently is.

A replacement plan should start from the question this one skipped: **`isAgentFree` already computes `free` — which consumer fails to ask it?** If the answer is *the board's registry never joins `branch` to `state` for a free agent*, the fix is a reader, not a word, and it touches no enum, no corpus pair and no `=== 'running'` gate.


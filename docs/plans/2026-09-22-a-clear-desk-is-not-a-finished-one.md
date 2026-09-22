# A clear desk is not a finished one

> Three live agents poll in `sleep 60` while every reader calls them `finished`. They are not `running`, so the board hides them; they are not free, so the supervisor never hands them a slice. The fleet has idled all day with three agents available.

## Status

- **State:** Superseded
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Superseded:** 2026-09-22, by `the-board-asks-the-process-not-the-desk` — panel rejected it 4/4: the discriminator was false on two of its own three named desks, `idle` collides with `AgentActivitySchema` ten lines below the enum it would join, `tsc` names two of fourteen consumers, and the corpus pair forbids the change
- **Rounds:** 1
- **Supersedes:** `a-free-agent-is-not-a-finished-one`, `a-waiting-loop-has-not-finished`

## Changelog

- A free agent whose desk is clear is reported as available rather than finished. Measured 2026-09-22: three agents alive in `sleep 60` (pids 243, 6542, 27820) all read `finished`, `isAgentFree` requires `running`, and one supervisor tick reported `agents=3 idle=3 handed=0`. The board showed `WORKING: none` for a fleet with three healthy agents.

Board impact: yes. `WORKING` renders registry agents by their state, so these three appear nowhere today.

## Design

### What was measured, 2026-09-22

```
plot_worker_state .worktrees/free-fe7ff576   →  finished   pid 243    (alive, sleep 60)
plot_worker_state .worktrees/free-c810e5bb   →  finished   pid 6542   (alive, sleep 60)
plot_worker_state .worktrees/free-719604d9   →  finished   pid 27820  (alive, sleep 60)

plot-registryd tick  agents=3 left=3 handed=0 idle=3 no-free-agent=0
board                WORKING: none
```

**All three processes are alive.** Each has a `sleep 60` child and no `claude` child — the worker loop's between-slices poll. They finished their previous slices hours ago and released their `branch` fields to `""`.

### The chain, every link read

1. `plot-worker-state.sh:860` — the wrapper pid is alive, `.plot-worker.wrapper.pid` exists, `plot_worker_agent_alive` returns 1 (alive wrapper, no agent).
2. It routes to `plot_worker_task_state`, which the shell documents as *"the DESK decides what that means"*.
3. The desk is clear — no PR, no marker, not dirty, nothing unpushed — so the answer is `finished`.
4. `rules/agent-state.ts:140` does **the same thing** in the domain: `liveness === 'orphaned'` returns `taskState(readings.task)`.
5. `rules/task.ts` ends `return 'finished'` after four readings that are all false.
6. `rules/free.ts:isAgentFree` opens `if (reading.state !== 'running') return false`.
7. `rules/queue.ts:249` filters the free list with it, and `matchQueue` is the supervisor's assignment lock.

**`whyNotFree` prints `not running — finished`.** The agent is invisible to the board and unreachable by the queue.

### What the two rejected plans got wrong, and what this takes from them

Both proposed making one side disagree with the other. `a-free-agent-is-not-a-finished-one` wanted a new shell state `free`; `a-waiting-loop-has-not-finished` wanted a new arm reading pid-alive-and-no-exit.

**The panels rejected both, and the measurement says why:** shell and domain already agree. Both correctly report `finished` for a desk that is clear. There is no disagreement to fix — `docs/shell-and-domain.md` forbids adjusting either side of a declared corpus pair to make a comparison pass, and `corpus/agent-state.corpus.test.ts` is that pair.

**The defect is in what a clear desk MEANS, and it depends on whether the agent ever had a slice.**

`taskState`'s four readings — `hasPr`, `blocked`, `dirty`, `unpushed` — are all questions about a slice. For a dispatched agent whose slice ended, all false correctly means *the work is done and nothing is left behind*. For a **free** agent, all false means *this agent never had work*, which is the opposite conclusion from identical readings.

Five jurors across two panels endorsed the root-exclusion analysis: *absent is not false, a free agent's missing `claude` child is its normal state, and the code reads one of two meanings*. That analysis is kept whole. What changes is where the fix goes.

### The discriminator is detachment, and it is a launch-time fact

The second moderation required a discriminator that is *"a MEASUREMENT of the process… a launch-time fact, taken by the party that starts the agent, not a teardown record written by another process."*

Detachment is exactly that, and it is already true:

```
.worktrees/free-fe7ff576        HEAD detached, branch ''    ← plot-dispatch.sh --start, cut --detach
.worktrees/reaper-free-desk     branch bug/the-reaper-…     ← a dispatched slice
```

`plot-dispatch.sh --start` cuts a free agent's desk **detached at `origin/<main>`** because a free agent holds no slice. The dispatcher checks out a branch. The two populations are separated by a fact git records at creation, written by the party that starts the agent, and readable forever after without asking any process.

**It is the same reading PR #961 ships for the reaper**, which is evidence the estate already treats detachment as the free-desk signal rather than an invention here.

### Why `orphaned` is where this starts

`PidLiveness` carries `orphaned` — *the pid answers and is the right process, and no agent runs* — and `agentState` returns on it **before any exit arm** (`agent-state.ts:137-140`), documented: an orphaned wrapper has written no exit file.

**The second panel's refutation stands and is not re-litigated:** a proposed arm reading *pid alive AND no exit record → running* fires on all three desks above, of which one was actually working. This plan proposes no such arm. `orphaned` correctly identifies the population; the bug is what `taskState` concludes about it.

### What changes

**One reading added, on both sides of the corpus pair, in one branch.**

`TaskReadings` gains `hasSlice: boolean` — whether this desk was cut for a slice. The final arm splits:

```ts
export const taskState = (readings: TaskReadings): TaskState => {
  if (readings.hasPr) return 'finished';
  if (readings.blocked) return 'waiting';
  if (readings.dirty) return 'stalled';
  if (readings.unpushed === true) return 'stalled';
  return readings.hasSlice ? 'finished' : 'idle';
};
```

The three arms above are untouched: a free desk carrying a marker is still `waiting`, and one carrying uncommitted work is still `stalled`. Only the all-clear case splits, because only there does the same evidence carry two meanings.

**`idle` is the new word, and it is not `free`.** `rules/free.ts` already returns `free` for availability, `DESIGN-agent.md:487` records `free` as availability and deliberately unmodelled as a state, and all four jurors on the first panel named that collision. `idle` says *this process is alive and has nothing to do*, which is a state; `free` says *this agent may be given work*, which is a verdict `isAgentFree` computes.

**`isAgentFree` gains `idle`:**

```ts
if (reading.state !== 'running' && reading.state !== 'idle') return false;
```

This is the link the first panel found fatal in its predecessor — a new state that `isAgentFree` rejects makes the started agents *undispatchable*, the opposite of the goal. It is stated here as a required change rather than left implicit.

### What this deliberately does not touch

- **`workerAlive` in either implementation.** Both read `.plot-worker.pid` and neither consults the shell state; the first panel verified this and both rejected plans' guards against touching it are kept.
- **`dropSettledWorkers`** and `fleet.ts:2983`'s `bashCleanliness` condition. The sixth link the second moderation asked to have stated: the drop is conditional, and `defaultCleanliness()` drops nobody. Nothing here depends on it.
- **`agentState`'s arm ordering.** The `orphaned` arm returns before the exit arms by documented design and stays.
- **The five reap refusals.** Unrelated to this reading.

### Done when

- `plot_worker_state` answers `idle` for a detached desk with a live wrapper, no agent and nothing left behind; it still answers `finished` for a dispatched desk in the same process state.
- `taskState` answers `idle` for the same readings with `hasSlice: false`, and `finished` with `hasSlice: true`.
- A desk carrying a `PLOT-BLOCKED` marker answers `waiting` and one carrying uncommitted work answers `stalled`, **whether or not it has a slice** — the split touches only the all-clear arm.
- `isAgentFree` returns true for an `idle` agent holding no branch; `whyNotFree` no longer prints `not running — finished` for a live free agent.
- `corpus/agent-state.corpus.test.ts` covers the detached case on both sides and passes. It covers none today — measured, `grep -c detached` returns 0.
- A supervisor tick against three idle agents and one claimable slice reports `handed=1`, not `handed=0 idle=3`.
- `AgentStateSchema` carries `idle`, and `transitions/agent.ts`'s `STATE_SOURCE` sources it — `test/agent-state.test.ts` asserts every state this rule answers is one the specification sources, so an unsourced state fails there.
- The domain's 100% coverage floor holds; the board artifact is rebuilt.

### Risk, stated plainly

**A new state is read by every consumer of `AgentState`.** The first panel's fatal finding was a state that `isAgentFree` silently rejected. The mitigation is not a promise to be careful: `AgentStateSchema` is a Zod enum and `STATE_SOURCE` is exhaustively keyed, so `tsc` names every site that must decide about `idle`. The done-when requires the board's `WORKING` section to render it, because an agent visible to the queue and absent from the board is the same defect in the other direction.

## Slices

### A clear desk says idle (Branch: bug/a-clear-desk-says-idle)

- `bug/a-clear-desk-says-idle` — add `hasSlice` to `TaskReadings` and split `taskState`'s final arm; add `idle` to `AgentStateSchema` and `STATE_SOURCE`; teach `isAgentFree` and `whyNotFree` the state; make `plot-worker-state.sh` read detachment and answer `idle`; extend `corpus/agent-state.corpus.test.ts` to cover a detached clear desk on both sides; render `idle` in the board's `WORKING` section

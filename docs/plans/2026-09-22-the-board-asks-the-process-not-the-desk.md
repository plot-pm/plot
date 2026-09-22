# The board asks the process, not the desk

> The queue already finds the three free agents — `no-free-agent=0` on every tick. Only the board cannot see them, because the registry row reads `plot-worker-state.sh`, whose `finished` answers a question about the DESK while the row is asking about the PROCESS.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Supersedes:** `a-clear-desk-is-not-a-finished-one` (panel-rejected 4/4, 2026-09-22)

## Changelog

- A live agent between slices appears in the board's WORKING section. Measured 2026-09-22: three agents alive in `sleep 60` (pids 243, 6542, 27820) rendered `WORKING: none` for a whole day, while the supervisor's own tick reported `no-free-agent=0` — the queue could see them the entire time.

Board impact: yes, and it is the whole subject. No new state, no schema change, no wire field.

## Design

### What the three previous attempts got wrong, and this one starts from their correction

Three plans have proposed a ninth agent state and all three were rejected — `free` collides with `rules/free.ts`, a pid-alive arm over-fires on every orphaned desk, and `idle` collides with `AgentActivitySchema` ten lines below the enum it would join. The last moderation's recommendation was explicit:

> **Consider not adding a state at all.** A plan that changes what `isAgentFree` READS, rather than what `agentState` ANSWERS, has none of findings 2, 3 or 4 against it.

**Following that recommendation found something better than a smaller fix: the queue is not broken.**

### The measurement that reframes it

```
plot-registryd tick  agents=3 left=3 handed=0 held=265 idle=3
                     no-brief=1 not-claimable=264 no-free-agent=0
```

**`no-free-agent=0`.** The free list was never the binding constraint. `isAgentFree` is finding all three agents on every tick; 265 slices are held because 264 are not claimable and one has no brief. **The fleet is idle because there is nothing to hand out, not because the agents look finished.**

Verified in source, the queue path never consults the shell:

```ts
// queue-reading.ts:249
const stateOf = async (entry, world) => {
  if (!(await world.workerAlive(entry.worktree))) return 'none';
  return (await world.blocked(entry.worktree)) ? 'waiting' : 'running';
};
```

`workerAlive` reads `.plot-worker.pid` and asks whether the process answers (`supervisor.ts:324`). All three pass, so all three read `running`, and `isAgentFree` returns true on `branch === ''`.

**So three plans have been written to fix a path that works.**

### Where the defect actually is

The board's agent row takes a different source. `registry.ts:16`:

> the state comes from `plot-worker-state.sh`, never from the manifest pid — `bashLiveness` hands the …

The shell answers eight states, and for a live wrapper with no `claude` child it routes to the DESK (`plot-worker-state.sh:872`) — *"The DESK decides what that means"* — which answers `finished` for a clear tree. `LIVE_STATES` is `{running, waiting}`, so the row is filtered out of WORKING.

**Both readings are honest and they answer different questions.** `CLAUDE.md` states the split that settles which one the row wants:

> a state answering *what is the process doing?* goes on the worker; one answering *what does this agent owe, or still hold?* goes on the agent.

WORKING renders **registry agents** and asks *is this agent alive and working here*. That is a process question. The desk's refinement answers *what did the last slice leave behind*, which is the agent question — correct for a dispatched worker that exited, and not what the row is asking.

### The change

**The registry row's liveness comes from the process, the way the queue's already does.**

Where `plot-worker-state.sh` answers `finished` **and the recorded pid is alive**, the row reads `running`. Nothing else moves:

- an exited worker still reads `finished` — the pid is gone, and that is the state's own meaning
- `waiting` still outranks it — a `PLOT-BLOCKED` marker is a desk fact about a live process, already in `LIVE_STATES`, and the shell tests it first
- `stalled`, `failed`, `ended`, `none`, `elsewhere` are untouched

**The reading is `.plot-worker.pid` plus liveness — the same two facts `workerAlive` uses.** Not detachment, which the last panel measured false on two of three desks; not an exit record, which the wrapper writes at teardown and cannot distinguish never-started from waiting. This reading is true on all three live desks right now and is exactly what the working path already trusts.

### Why this has none of the rejections' problems

| the last panel's finding | here |
|---|---|
| `idle` collides with `AgentActivitySchema` | **no new state** — `running` already exists and already means this |
| `tsc` names 2 of 14 consumers | **no enum change**, so no consumer must decide anything new |
| `isLiveState` is a denylist and would pass a new state silently | `running` is in `LIVE_STATES` explicitly |
| the corpus pair forbids a one-sided change | **the shell is not changed** |
| the discriminator mutates mid-life | a pid file written at launch and a `kill -0` — the two facts the queue path has trusted all along |

### What must not break

**The shell keeps its answer.** `plot-worker-state.sh` is asked by the reaper, by dispatch and by the fleet scan, and `finished` is right for all three — they ask about the desk. This changes one consumer's reading, not the script.

**`agentState`'s `orphaned` arm stays.** It routes to `taskState` by documented design, and the reaper depends on it: a desk whose wrapper is alive and whose work is unpushed must still read `stalled`.

**A desk with unlanded work must not read `running` merely because a pid answers.** The shell tests `stalled` and `waiting` before `finished`, so only the all-clear case is reached — and the change applies to that case alone.

**The queue must be unaffected.** It already reads the process and must keep doing so; this adds no second path, it makes the row agree with the one that works.

### Done when

- An agent alive in `sleep 60` between slices renders in WORKING. Measured today: three do not.
- A worker that exited with a clear desk still reads `finished` and stays out of WORKING.
- A live worker with a `PLOT-BLOCKED` marker still reads `waiting`; one with unpushed work still reads `stalled`.
- `plot-worker-state.sh` is unchanged, and `corpus/agent-state.corpus.test.ts` still passes.
- The queue's own path is untouched — `no-free-agent=0` before and after, proved by a tick.
- A browser test asserts a live between-slices agent appears in WORKING; that section had no such fixture, which is why a whole day of `none` looked plausible.

### What this plan does NOT claim

**It does not make the fleet dispatch more.** `handed=0` is `not-claimable=264` and `no-brief=1`, and neither is an agent problem. A reader expecting more work to flow from this will be disappointed, and that expectation is what the three previous plans were built on.

**It fixes a display that was wrong for a day** — which is worth fixing precisely because it sent three plans at the wrong layer.

## Slices

### The row reads the process (Branch: bug/the-row-reads-the-process)

- `bug/the-row-reads-the-process` — the registry row's state reads `running` where the shell answers `finished` and the recorded pid is alive, leaving every other state and the shell itself untouched; unit tests for the live and exited cases; a browser test pinning a between-slices agent in WORKING

## Notes

- **Found by following the third panel's recommendation rather than my own next idea.** It said to change what `isAgentFree` reads; reading that rule showed it needed no change at all, and the tick's `no-free-agent=0` confirmed it. Three plans were aimed at a working path.
- The three rejected plans' diagnosis — *absent is not false; a free agent's missing `claude` child is its normal state* — is endorsed by nine jurors and survives here whole. What changes is which consumer was wrong about it.
- **Twelve jurors across four panels have now read this defect.** The cost of the three rejections was four wrong plans; the return is that the surviving one changes one reading in one consumer.

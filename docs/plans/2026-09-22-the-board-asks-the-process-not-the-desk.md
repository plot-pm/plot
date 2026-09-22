# The board asks the process, not the desk

> The queue already finds the three free agents — `idle=3` on every tick. Only the board cannot see them, because the registry row reads `plot-worker-state.sh`, whose `finished` answers a question about the DESK while the row is asking about the PROCESS.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-22, in-session review after panel (amend 3/3, amendments applied)
- **Started:** 2026-09-22, jwloka, `bug/the-row-reads-the-process`
- **Rounds:** 1
- **Supersedes:** `a-clear-desk-is-not-a-finished-one` (panel-rejected 4/4, 2026-09-22)

## Changelog

- A live agent between slices appears in the board's WORKING section. Measured 2026-09-22: three agents alive in `sleep 60` (pids 243, 6542, 27820) rendered `WORKING: none` for a whole day, while the supervisor's own tick reported `idle=3` — the queue could see them the entire time.

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

**`idle=3` against `agents=3`.** `entry/registryd.ts:324` emits `idle=${queue.idle.length}`, and `queue.idle` is `free.slice(next)` — sliced straight off the list `isAgentFree` computed, with **no slice-level gating in front of it**. All three agents passed the rule. 265 slices are held because 264 are not claimable and one has no brief. **The fleet is idle because there is nothing to hand out, not because the agents look finished.**

**`no-free-agent=0` is NOT the evidence, and reading it as such is an error this plan made in its first draft.** `rules/queue.ts:249` increments that counter inside the slice loop *after* the readiness gate, so all 266 slices took the first `continue` and the test never ran. Measured by forcing the three agents' state to `finished` and re-running `matchQueue`: the counter goes **up**, to 1. It reads 0 whether the free list holds three agents or none.

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

**The site is `registry.ts:811-814`** — `refreshStates`, which assigns `entry.state = KNOWN_STATES.has(answer) ? answer : 'unknown'`. That is the assignment; `bashLiveness` at `:865` is the derivation, and `KNOWN_STATES` at `:55` is a membership filter that decides nothing about which state is right. **A second reader shares the same resolver**: `drop.ts:151`'s `classifyState` calls the injected `LivenessResolver` for one entry, so whichever site is chosen must account for it.

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

**A desk with unlanded work must not read `running` merely because a pid answers — and the guard is NOT the arm order.** Measured against the real shell on five synthetic desks, `finished` + a live pid has five ways in, not one:

| desk | PR fact | shell answers |
|---|---|---|
| clean | `''` | `finished` |
| dirty | `''` | `stalled` |
| **dirty** | **`pr`** | **`finished`** |
| **blocked** | **`pr`** | **`finished`** |
| blocked | `''` | `waiting` |

`taskState`'s **first** arm is `if (readings.hasPr) return 'finished'`, which outranks `blocked` and `dirty` both. **What makes the reading unambiguous here is that `registry.ts:870` hardcodes an empty PR argument** — `plot_worker_state "$wt" ''` — so rows three and four are unreachable on this path.

**That guard is an argument literal three lines from the change, and it must be commented at the change site.** A later caller passing a real PR fact would silently widen the set to include a dirty or blocked desk, and nothing would say so. This plan's first draft asserted the arm order instead, which is false — a safety argument that is wrong is dangerous even where the code is right.

**The queue must be unaffected.** It already reads the process and must keep doing so; this adds no second path, it makes the row agree with the one that works.

### It is not a display change, and this needs a decision

**`autoDispatch: true` on this machine.** The registry row's `state` feeds two counters that are both halves of auto-dispatch's budget (`auto-dispatch.ts:123`, `:190`):

```ts
let budget = controls.parallelAgents - (liveCount + inFlight.size);
if (budget <= 0) { budget = freeAgentCount(agents, pulse); if (budget <= 0) return []; }
```

`pruneInFlight` at `:889` also reads `LIVE_STATES` to decide which in-flight marks retire. **So flipping three rows from `finished` to `running` changes what the board starts on its own**, and the first draft of this plan did not mention it.

Of ten readers traced, seven are honest improvements — and one is a stated invariant being repaired: `fleet.ts:7642`'s own comment requires its count to equal what WORKING renders, which today is 0 while three agents live.

**The open question is the budget, and it is a decision rather than a correction.** Three agents that become visible genuinely occupy machine slots, so `liveCount` rising is arguably the correct arithmetic and today's `0` is the bug. But it means the change alters dispatch behaviour, not only rendering.

**Both directions must be deliberate:**

- **Let the budget see them** — `liveCount` rises by three, so `parallelAgents - liveCount` falls and the board starts *fewer* workers. Correct if these agents are occupying slots, which they are.
- **Hold the budget** — scope the reading to the display path only, leaving `auto-dispatch.ts` on today's counts.

**Settled 2026-09-22 by the operator: LET THE BUDGET SEE THEM.** `liveCount` rises by three, the fall-through goes from *start up to 5* to *start up to 2*, and the board starts fewer workers.

The reason is the consequence juror's: three live agents genuinely occupy machine slots, so counting them is the correct arithmetic and today's `0` is the bug — `fleet.ts:7642`'s own comment already requires its count to equal what WORKING renders. Scoping the reading to the display path would repair the invariant in one place and leave it broken in the other.

**So this is a dispatch change as well as a display one, and the implementer must treat it as such.** `liveAgentCount`, `freeAgentCount` and `pruneInFlight` each need a test pinning their behaviour for a between-slices agent, and the PR must say in its body that the fall-through budget narrows on a machine with live agents.

### Done when

- An agent alive in `sleep 60` between slices renders in WORKING. Measured today: three do not.
- A worker that exited with a clear desk still reads `finished` and stays out of WORKING.
- A live worker with a `PLOT-BLOCKED` marker still reads `waiting`; one with unpushed work still reads `stalled`.
- `plot-worker-state.sh` is unchanged, and `corpus/agent-state.corpus.test.ts` still passes.
- The queue's own path is untouched — **`idle=3 agents=3`** before and after, proved by a tick. (`no-free-agent=0` is not a regression test: it reads 0 today, after the change, and also if the change broke `isAgentFree` outright.)
- A browser test asserts a live between-slices agent appears in WORKING; that section had no such fixture, which is why a whole day of `none` looked plausible.
- **The auto-dispatch budget question above is answered explicitly**, and whichever way it goes, `liveAgentCount`, `freeAgentCount` and `pruneInFlight` each have a test pinning their behaviour for a between-slices agent. A change to what the board STARTS must not arrive as a side effect of a change to what it SHOWS.

### What this plan does NOT claim

**It does not make the fleet dispatch more.** `handed=0` is `not-claimable=264` and `no-brief=1`, and neither is an agent problem. A reader expecting more work to flow from this will be disappointed, and that expectation is what the three previous plans were built on.

**It fixes a display that was wrong for a day** — which is worth fixing precisely because it sent three plans at the wrong layer.

**And the three exhibits are dispatched workers between slices, not never-dispatched free agents.** All three took a slice earlier and released it; two still hold the branch their last slice used. The fix covers them either way, because it reads the pid rather than the desk — but the description should match what was measured.

## Slices

### The row reads the process (Branch: bug/the-row-reads-the-process)

- `bug/the-row-reads-the-process` — the registry row's state reads `running` where the shell answers `finished` and the recorded pid is alive, leaving every other state and the shell itself untouched; unit tests for the live and exited cases; a browser test pinning a between-slices agent in WORKING

## Notes

- **Found by following the third panel's recommendation rather than my own next idea.** It said to change what `isAgentFree` reads; reading that rule showed it needed no change at all, and the tick's `idle=3` confirmed it. Three plans were aimed at a working path.
- The three rejected plans' diagnosis — *absent is not false; a free agent's missing `claude` child is its normal state* — is endorsed by nine jurors and survives here whole. What changes is which consumer was wrong about it.
- **Twelve jurors across four panels have now read this defect.** The cost of the three rejections was four wrong plans; the return is that the surviving one changes one reading in one consumer.

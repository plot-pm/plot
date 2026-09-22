# A waiting loop has not finished

> `plot-worker-state.sh` answers `finished` for an agent whose loop is alive and waiting for work, so the registry drops it and an operator who started agents sees nothing on the board.

> **REJECTED BY PANEL, 2026-09-22 — and this rewrite failed the same way its predecessor did, one level deeper.** The corpus lens found that **`orphaned` already exists** as a fourth `PidLiveness` value, and that `agentState` handles it with a comment describing exactly this population. The proposed arm — *pid alive AND no exit record → running* — fires on **every orphaned desk**, because an orphaned wrapper by construction has no exit record. **Measured on this estate the day it was written: three desks match, and only ONE was actually working.** The other two would have been reported `running`, re-introducing the defect commit `64787cd4b` fixed — *"four agents ended mid-slice and every one reported `running`"*. The plan's own guard (*"a dispatched agent with an EXIT RECORD still reads finished"*) protects a population that was never at risk. **The root failure is named by the juror and is mine: the plan answered the previous panel faithfully and did not re-read the code, and the code had moved.** See `.plot/panels/2026-09-22-a-waiting-loop-has-not-finished/`. **Not dispatchable as written.**

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches

## Changelog

- An agent waiting to be handed work is no longer reported as finished. `plot-worker-state.sh` refined a clean exit by the tree, and a waiting loop has not exited at all — so the board dropped a live agent and `/api/fleet` answered `agents: 0` while the process ran and its log read *"Waiting to be handed work"*.

Board impact: yes, and it is the subject — the registry keeps a row it was dropping. No new state crosses the wire.

## Design

**This plan replaces `2026-09-22-a-free-agent-is-not-a-finished-one.md`, which a four-lens panel rejected.** The moderation is `.plot/panels/2026-09-22-a-free-agent-is-not-a-finished-one/panel.md` and the three findings that sank it are answered below by name.

### What was measured, and what was measured WRONG

The symptom reproduces: an agent alive for ten minutes, desk clean, log reading *"Waiting to be handed work"*, and

```
plot_worker_state <desk>  →  finished    (live pid)
```

A juror reproduced it from a fixture and named the path: `plot_worker_state:860` → `plot_worker_agent_alive` returns 1 → `plot_worker_task_state` on a clean desk → `finished`.

**The rejected plan's causal chain was wrong and it is worth stating why**, because it is the trap this rewrite avoids. It claimed the shell's `finished` poisons `isAgentFree` through `stateOf`. **It does not.** Both `workerAlive` implementations read `.plot-worker.pid` and ask `processes.isAlive` — neither touches the shell:

```ts
// entry/registryd-main.ts:479 and server/supervisor.ts:324
const pid = …;  if (pid === null) return false;  return isAlive(pid);
```

`stateOf` then answers `running`, and `matchQueue` sees a free agent. **The assignment path was never broken.**

### Where `finished` actually costs something

`registry.ts:826` — `defaultLiveness` routes the board's registry read through `bashLiveness`, which sources `plot-worker-state.sh` for a batch of worktrees. That answer reaches `dropSettledWorkers`, whose first pass is:

```ts
if (e.state === 'running') continue;   // Live session — keep.
```

**So a waiting agent is not kept, becomes a drop candidate, and is dropped when its desk is clean** — which a waiting agent's desk always is. The row vanishes from `/api/fleet` and the board shows nothing.

**This is a DISPLAY defect, not an assignment defect.** Narrowing that claim is the rewrite's main correction: the operator's complaint was *"I cannot see the agents"*, and that is exactly and only what is broken.

### The reading, and why it is wrong for this population

`plot_worker_task_state` refines a **clean exit** into `finished` / `waiting` / `stalled`. The refinement is right; its precondition is not met. `plot_worker_agent_alive` asks whether any **descendant** is named `claude`, excluding the root deliberately:

> THE ROOT ITSELF IS EXCLUDED. The recorded pid is the loop shell by construction, and a shell that matched would make every desk read alive.

**That exclusion is correct and stays.** What is wrong is treating its negative answer as *the work is over*. A waiting loop has spawned nothing **and has not exited** — the absence of a descendant is its normal state, not evidence of an exit. Same *absent is not false* shape as `an-unasked-host-is-not-an-absent-pr`, one layer down.

### The discriminator is a process fact, and the panel's objection decides it

**The rejected plan used the manifest's `branch: ""`.** Three reasons that is refused, each verified:

- `plot-worker-loop.sh:2150` writes `branch: ""` when a slice **finishes** — *"THE AGENT IS NOW FREE, so the manifest stops naming a slice"*. The value is reachable for an exiting agent.
- `rules/free.ts` makes a **branch-naming** agent free when `sliceHasMerged`, so the discriminator is wrong in both directions.
- `plot-worker-state.sh` takes a worktree, not a manifest. Reading a field four other things write, from a file it is not given, is not a measurement.

**The measurement this plan uses instead is the loop's own exit record.** `plot_worker_task_state` is only ever asked about an exit, and the estate already distinguishes *exited* from *never exited*: `.plot-worker.exit` is written by the wrapper when the child returns. **A desk with a live pid and no exit record has not exited**, and that is a fact about the process rather than about a manifest.

So the arm to add is: **the recorded pid is alive AND no exit record exists** → the loop is running, whatever its descendants. `plot-worker-state.sh:848`'s `.plot-worker.wrapper.pid` is the estate's precedent for a launch-time fact of exactly this kind.

**The file is already read, and the structure makes the change one branch.** `plot-worker-state.sh:870` reads `.plot-worker.exit` — but that block sits AFTER the live-pid block and is reached only when the process is dead. Inside the live block, the path is:

```sh
if plot_worker_agent_alive "$pid"; then      # a claude descendant → running
elif [ "$?" -eq 1 ]; then                    # none → task state → finished
```

**The second arm is the defect**, and the guard belongs immediately before it: a desk with no `.plot-worker.exit` has not exited, so `plot_worker_task_state` — which exists to refine *a clean exit* — must not be asked at all. Verified on this estate: the waiting desk has `.plot-worker.pid` and **no** `.plot-worker.exit`; a finished one carries `exit=124`.

### The word, and why there is no new state

**No ninth state.** `DESIGN-agent.md:487` states that `free` is availability and unmodelled as a state, `agentAvailability` already returns the word, and `AgentStateSchema` is paired with the shell by `corpus/agent-state.corpus.test.ts` — verified: the file exists, and the schema does not contain `free`.

**The answer is `running`**, which is what the eight-state table already means by *the pid answers*, and what `dropSettledWorkers` already keeps. A waiting loop IS running; it was being misclassified, not lacking a name.

**That also makes the corpus pair pass rather than fail.** `agentState` answers from the same readings; both sides move to `running` together, in one slice.

### What must not break

**A dispatched agent with no `claude` child and an EXIT RECORD still reads `finished`.** That is the case the current arm exists for and the common one. The new arm requires the absence of an exit record, so it cannot fire there.

**The root-exclusion stays exactly as it is.** A matching shell would make every desk read alive; this adds a second reading rather than loosening the first.

**`dropSettledWorkers` is untouched.** Its predicate is correct; it was being handed a wrong state.

**Both `workerAlive` implementations are untouched.** They were already right, which is the rejected plan's main error and must not be repeated by "fixing" them.

## Slices

### The loop is running until it exits (Branch: bug/the-loop-is-running-until-it-exits) <!-- deferred: rejected by panel 2026-09-22 — the arm fires on every orphaned desk, measured 3 on this estate of which 1 was working. `orphaned` already exists as a PidLiveness value and agentState returns on it before any exit arm. Re-read the code before rewriting -->

- `bug/the-loop-is-running-until-it-exits` — `plot-worker-state.sh` answers `running` where the recorded pid is alive and no exit record exists, before the descendant question is asked; `rules/agent-state.ts` gains the same arm from the same readings so `corpus/agent-state.corpus.test.ts` passes on both sides in one slice. Tests pin that a desk WITH an exit record and no `claude` child still reads `finished`, that the root-exclusion still refuses to read a bare loop shell as alive for a dispatched desk, and that `dropSettledWorkers` keeps the row

## Notes

- The predecessor plan is kept rather than deleted: its root-exclusion analysis was endorsed by a juror who rejected it, and its three wrong turns are recorded so nobody re-checks them.
- **The board's `WORKING` section filtering to live states is correct and out of scope.** A waiting agent is not working. Where it should be shown is the board's question; this plan only stops it being dropped from the payload.

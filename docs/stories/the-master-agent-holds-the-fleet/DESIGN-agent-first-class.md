# What changes to make an Agent first class

> Asked 2026-09-22: the registry starts agents, they run until it deliberately stops them, they receive work while running, and the dispatcher may request more when no slot is free. **Three of the four are already the design. One is a real change, and one defect is why none of it works today.**

## The four claims, measured against the specs and the code

| the claim | status |
|---|---|
| The registry starts them | **already the design** — `DESIGN-agent.md:167` |
| They run until deliberately stopped | **already the design** — free agents wait out the `Worker bound` |
| They receive work while running | **already the design AND already built** — `matchQueue` is the assignment lock |
| The dispatcher may request agents | **a real change**, and the specs argue against it twice |

## What is already there, and it goes further than expected

`DESIGN-agent.md:167` states the chain in the order the question asks for:

```
the operator asks the registry for N agents
    → the registry SPAWNS each agent, and spawning it IS starting its process
an agent between units is FREE — running, no branch, no slice
a dispatch goes to a free agent
```

**The domain has the rule.** `rules/free.ts` derives availability rather than storing it, and `matchQueue` consumes it:

```ts
export const isAgentFree = (reading: AgentReading): boolean => {
  if (reading.state !== 'running') return false;
  return reading.branch === '' || reading.sliceHasMerged;
};
```

Two ways to be free, and the second is the one a naive rule misses: **a running agent whose slice has LANDED is free and still names a branch.**

## The defect that makes the model look absent

**`isAgentFree` requires `state === 'running'`, and a free agent does not report it.**

Measured 2026-09-22: an agent started with `--start 1`, alive for ten minutes, log reading *"Waiting to be handed work"* — and `plot-worker-state.sh` answering **`finished`**. `plot_worker_state` establishes the pid answers `kill -0`, then asks whether any **descendant** is named `claude`, excluding the root deliberately. A free agent runs nothing but the loop, so it has no such descendant.

So the chain breaks at its first link: the agent is free, the rule cannot see it, `matchQueue` finds nobody, and an operator watching the board sees nothing at all. **The plan is `docs/plans/2026-09-22-a-free-agent-is-not-a-finished-one.md`.**

**The lifecycle table has no word for it either.** Eight states, and none means *running and idle* — `running` means *the pid answers*, which is true but not the fact a reader needs. That is the same absence one layer up.

## The one real change, and the argument against it

*"The dispatcher requests agents when no slot is available"* is refused in two specs with one sentence: **`a dispatch never asks the machine for capacity`** (`DESIGN-agent.md:173`, `DESIGN-machine.md:542`).

The reason is stated and is not casual:

> The machine comes under pressure from what the agents DO, not from a request arriving at it. … Nothing in that path refuses or defers.

`DESIGN-machine.md` §10 spent two revisions establishing that **headroom is a prediction, and a prediction does not earn a refusal.** A dispatch that asked for capacity would become synchronous with fleet size, which is the coupling those revisions removed.

### But the objection does not cover what is actually being asked

**Requesting is not refusing, and the spec already draws that line for counting:**

> `0 free` is the same kind of fact as *this branch is claimed*, which Plot already rests on entirely.

A dispatch that **queues regardless** and additionally **reports that nothing can take the work** neither refuses nor defers — it stays asynchronous and adds a fact. The measurement is already taken: `plot-registryd` prints `no-free-agent=N` every tick.

**And the machinery exists.** `--start-agents` is opt-in on the daemon and starts free agents toward the board's `Parallel agents` cap, *"read fresh every tick so the stepper and the daemon cannot give two answers to one question"*. So the supervisor already starts agents from a queue it cannot staff.

**What does not exist is the dispatcher saying so.** `plot-dispatch.sh` states the opposite as a property: *"IT REFUSES NOTHING FOR WANT OF A FREE AGENT, and never asks."*

### The distinction to settle before building

| shape | verdict |
|---|---|
| dispatch **refuses** when no agent is free | refused — this is the coupling two revisions removed |
| dispatch **blocks** until one is free | refused — same coupling, slower |
| dispatch **queues and reports** `no-free-agent` | **available today**, and the daemon already acts on it |
| dispatch **asks the registry to start one** | the open question |

**The fourth is the only genuinely new one**, and the argument for it is that the supervisor's `--start-agents` already does exactly this — from the queue's side rather than the dispatcher's. Whether the dispatcher should also be able to ask is a question about *who owns the decision*, not about coupling: the queue is already the trigger.

## What to change, in order

1. **Fix the free-agent state.** Nothing else in this document can be observed until an idle agent reports `running` rather than `finished`. Plan written.
2. **Give the lifecycle a word for it.** Eight states and none says *running and idle*; the reader needs it and so does the board.
3. **Then decide the dispatcher's ask** — and decide it as an ownership question, with `--start-agents` on the table as the existing answer from the other direction.

**Nothing here proposes changing the Agent/Worker split.** `DESIGN-agent.md`'s three lifetimes — manifest to the Registry, worktree to the agent, worker to the Machine — survive this question intact. What changes is that the worker's bracket is the AGENT's life rather than one slice's, which the free agent already demonstrates and the spec already says.

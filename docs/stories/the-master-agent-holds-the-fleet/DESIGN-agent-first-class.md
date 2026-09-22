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

## Asked 2026-09-22: the fleet MAINTAINS N, with capabilities

Two further claims, measured the same way.

### "N agents at start, and the fleet keeps N available" — already built

`rules/fleet-size.ts` holds the maintenance semantics explicitly:

> **THE FLEET ALREADY ON THE MACHINE IS SUBTRACTED FIRST**, because `start N` asks for a fleet of N rather than for N more. Running it twice must not give six agents.

And `workflows/assign.ts:178` runs it **every supervisor tick**, not only at start:

```ts
const waiting = held.filter((slice) => slice.hold === 'no-free-agent').length;
const running = readings.agents.length;          // free or busy alike
fleetSize({ requested: waiting === 0 ? running : fleet.size, running, … });
```

**Read that `requested` line carefully, because it is the whole policy:** with nothing waiting it asks for exactly what is running — a no-op — and the moment one slice is held on `no-free-agent` it asks for the full `fleet.size`. So the fleet is topped up **on demand rather than held at N**, which is a deliberate difference from the question as put.

The counting rule is stated too: **every registered agent counts as running, free or busy**, because *"a free agent is carrying one — it holds a slot and is about to be handed a slice"*.

**Two bounds are reported rather than silently applied** — the machine's headroom, and the desks the daemon could cut this tick. An operator reading `started 1 of 3` must be able to tell which one stopped it.

**So the only gap against the claim is the trigger**: top-up happens when a slice is waiting, not continuously.

### Settled 2026-09-22: the fleet must KEEP N, and the gap is measurable right now

The operator's statement is that a person calls the controller, and from then on the fleet **with the registry** must ensure the agents are provided **and stay available**. That is availability as a standing obligation, not a response to a queue.

**The order already persists.** `.plot/state/fleet-controls.json` holds `parallelAgents: 5` and survives restarts — so the fleet is told what it owes and keeps the number. Measured on this estate, minutes after this was written:

```
ordered:     5
registered:  1
```

**Nothing is topping it up, because nothing is waiting.** `requested: waiting === 0 ? running : fleet.size` makes the tick a no-op whenever the queue is empty, so a fleet that loses agents overnight shrinks silently and an operator who ordered five has one.

**The cost argument for the current shape does not survive the measurement.** *"Holding N warm pays for work that may not arrive"* is true, and it is what the operator ORDERED — `parallelAgents` is the statement of how much warm capacity they want to pay for. A fleet that quietly under-delivers the order is not saving the operator money; it is ignoring the number they set.

**And the latency it trades for is real**: work arrives, the slice is held on `no-free-agent`, the tick then starts an agent, and the dispatch waits out a spawn it could have avoided. The current shape moves the cost from memory to the critical path, which is the wrong direction for the one thing an operator watches.

**The change is one expression, and its blast radius is the reason to be careful:**

```ts
requested: fleet.size      // rather than `waiting === 0 ? running : fleet.size`
```

`fleetSize` already subtracts `running` and reports both bounds, so the arithmetic needs nothing. What needs deciding is the **stop condition** — a fleet that always asks for `fleet.size` will restart an agent an operator killed by hand, and `--stop` sets no order to zero today. **Maintaining N requires that stopping means setting N**, or the two commands fight every 60 seconds.

### "with the requested capabilities" — the one genuine gap

**The vocabulary exists and is not connected.** `entities/charter.ts` carries `capabilities: readonly string[]` and defines a charter as *"what a person declared one agent to be"*, with the warning that matters:

> Declared rather than derived — a matcher reading a plan could guess a capability, and a guess that is usually right produces a fleet whose wrong answers cannot be explained.

**What does not exist:**

- `FleetCap` carries `size`, `headroom`, `spawnCostMs`, `desks` — **no capability**.
- `matchQueue` names capabilities nowhere; it filters on `isAgentFree` alone.
- A slice declares no capability requirement, and the charter spec forbids inferring one.

So the fleet can be asked for *three agents* and never for *three agents that can build the board*. Making that possible needs three things in order, and the middle one is the hard part:

1. **A slice declares what it needs** — and per the charter's own rule this must be declared, not guessed. That is a plan-format change, which is the expensive half.
2. **`matchQueue` matches a free agent's charter against that declaration**, and reports `no-capable-agent` distinctly from `no-free-agent` — otherwise a fleet with three idle agents and no matching one reads as full.
3. **`scaleUp` asks for the missing capability**, not merely for a bigger number.

### Measured after writing the above: step 1 exists and is unused

**The capability path is further along than the domain rules suggest.** `plot-dispatch.sh` sets `PLOT_AGENT` at four sites, `plan_declared_agent` reads a kind from the PLAN that names the branch, and a real charter exists:

```json
{ "name": "reviewer", "prompt": ".plot/worker-prompt.sh",
  "model": "opus", "effort": "high", "capabilities": ["read-only"] }
```

So a slice CAN already declare what it needs and the declaration reaches the worker as an environment variable. **Measured on this estate: 0 of 306 plans declare one.** The mechanism is built, unused, and therefore untested by practice.

**A missing charter is reported and dispatched anyway** (`plot-dispatch.sh:1012`) — the honest default, and the one that must not change: a declaration nobody can satisfy should degrade to an ordinary agent rather than starve a slice.

**What is still missing is the request half.** The declaration reaches an agent that ALREADY EXISTS; nothing asks the registry to bring one into being. `--start` cuts a free agent with `PLOT_AGENT` empty by construction — *"a free agent has no branch and so has no plan to read"* — so every agent the fleet maintains is generic.

### Settled 2026-09-22: the dispatcher may ask, and new capabilities come with it

The operator settles the open question from the previous section: on a dispatcher request, new agents should be provided **where possible**, including with capabilities the fleet does not yet hold.

**`where possible` is what makes this compatible with the coupling rule.** A request that may be answered *not now* is not a refusal of the dispatch — the slice still queues, exactly as `DESIGN-machine.md` §10 requires. The dispatcher gains a way to ASK; it gains no way to WAIT.

**So there are two triggers for one spawn path, and they differ in what they name:**

| trigger | asks for | answered by |
|---|---|---|
| the standing order | a COUNT — keep `parallelAgents` available | every tick, unconditionally |
| a dispatcher request | a CAPABILITY — one agent that can take this slice | best effort, reported when refused |

**The second must not consume the first.** An agent started to satisfy a capability request is still an agent, so it counts toward `running` and would otherwise let the standing order decay by one. Either the order counts only generic agents, or a capability agent is started ABOVE it — and that is the decision to make before building, because it is the difference between a fleet that drifts and one that does not.

**The hold vocabulary must split, and that is the gate.** `no-free-agent` today means *nobody is idle*. With capabilities it must also mean *somebody is idle and cannot do this*, and those are different requests to the registry — one asks for any agent, the other for a specific charter. A single word makes the second invisible, which is how three idle agents and a starving slice read as a full fleet.

**Step 2 is where the design decision lives.** A slice that names a capability nobody has must not starve silently, and `DESIGN-agent.md`'s own line — *"a specialised agent that never becomes a loop-worker still has a registry entry and still has no worker fields"* — says the model already expects such agents to exist.

### Settled 2026-09-22: ask up to the cap while the machine says yes

**This rule is already implemented and needs no change.** `rules/fleet-size.ts`:

```ts
const ceiling = ceilingFor(headroom);
const start = Math.min(wanted, ceiling);
```

and the machine's four answers:

| headroom | ceiling |
|---|---|
| `starved` | `STARVED_CEILING` |
| `tight` | `TIGHT_CEILING` |
| `clear` / `unmeasured` | **`Infinity`** — *"the machine is not vetoing, so the request stands"* |

**The refusal is explicitly not final**, which is what makes repeated asking safe:

> started 1 of 3 — the machine is at its bound … **Run it again when it clears.**

So a dispatcher that asks every tick costs nothing when the machine is tight and gets its agent the moment it clears. No backoff, no queue of pending requests, no state to keep — the ask is idempotent because `fleetSize` subtracts `running` first.

**`unmeasured` permitting is the deliberate half.** A machine that could not be read does not veto, for the reason `DESIGN-machine.md` §10 established: *headroom is a prediction, and a prediction does not earn a refusal.* An unreadable machine must not become a silent cap.

**So the complete shape is three bounds, all already enforced and all already reported:**

1. **the cap** — `parallelAgents`, what the operator ordered
2. **the machine** — `ceilingFor(headroom)`, which says *not now* rather than *no*
3. **the desks** — how many worktrees the tick could cut, reported separately so `started 1 of 3` never blames the machine for a disk

**Nothing in the ask-up-to-the-cap rule needs building.** What needs building is the two triggers reaching it: the standing order asking unconditionally rather than only when a slice waits, and the dispatcher's capability request arriving as a request at all.

## What to change, in order

1. **Fix the free-agent state.** Nothing else in this document can be observed until an idle agent reports `running` rather than `finished`. Plan written.
2. **Give the lifecycle a word for it.** Eight states and none says *running and idle*; the reader needs it and so does the board.
3. **Decide whether the fleet holds N warm or tops up on demand.** It tops up today, and the difference is a cost decision rather than a defect.
4. **Then decide the dispatcher's ask** — as an ownership question, with `--start-agents` on the table as the existing answer from the other direction.
5. **Capabilities last, and as three changes rather than one.** The declaration side is a plan-format change and the matching side needs a distinct `no-capable-agent` hold; neither is worth building before an idle agent is visible.

**Nothing here proposes changing the Agent/Worker split.** `DESIGN-agent.md`'s three lifetimes — manifest to the Registry, worktree to the agent, worker to the Machine — survive this question intact. What changes is that the worker's bracket is the AGENT's life rather than one slice's, which the free agent already demonstrates and the spec already says.

# The registry owns what it started

> A dispatch asks for a free agent, and the registry can name every process it spawned.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-30, Jan Wloka, in-session

## Approval

- **Assignee:** Jan Wloka

## Changelog

Auto-dispatch asks whether an agent is **free** rather than only how many slots
are taken, and the agent manifest records every process the registry spawned
instead of one of three.

## Motivation

### Four spec revisions on 2026-08-30, and the code disagrees with all of them

The Machine and Agent specs were revised four times in one afternoon, ending at
a model the operator stated plainly:

> Nothing starts a worker. The registry spawns an **agent**, and spawning it *is*
> starting its process. A dispatch goes to a **free** agent, so *"no free agent"*
> is a count rather than a prediction — the same kind of fact as *this branch is
> claimed*.

Two measurements say the code has not caught up.

### `isFree` exists, is tested, and nothing reads it

`packages/domain/src/entities/agent.ts:120` already answers the availability
question the specs argue about:

```ts
export const isFree = (agent: Agent, sliceHasMerged: boolean): boolean => {
  if (agent.state !== 'running') return false;
  return agent.branch === '' || sliceHasMerged;
};
```

Six assertions in `agent.test.ts` cover it. **Zero production call sites**
(measured 2026-08-30, across `packages/board/src` and `packages/domain/src`). So
the answer is written down and nobody asks it — which is why
`DESIGN-machine.md` spent two revisions arguing about predicting capacity while
`DESIGN-agent.md` was already counting it.

### The machine measures itself, and nothing asks it either

The same shape, one entity over. `packages/domain/src/entities/machine.ts` is
complete: `headroomFor`, `measureMachine`, `hasRoomToDispatch`,
`HEADROOM_THRESHOLDS` (`clear < 10 ms`, `starved > 50 ms`), a `MachineReading`
port that returns the reading and refuses to return the verdict, a
`machine-system.ts` adapter that times real forks with `git rev-parse --git-dir`,
and `machine.test.ts` beside it.

**Measured 2026-08-30: zero consumers of any of the three, and the adapter is
constructed nowhere.**

```
grep hasRoomToDispatch | measureMachine | headroomFor   →   0 outside machine.ts
grep machine-system                                     →   0 outside adapters/
```

**And it was needed the same day.** Deciding whether to dispatch, the spawn cost
was measured **by hand** — `for i in $(seq 1 100); do git rev-parse; done` — and
read against thresholds transcribed from the docstring:

```
23.3 ms   tight     (154 monitor processes, 152 of them orphaned)
76.5 ms   tight     (eight orphaned load loops from a merged branch, 100% CPU each)
 4.8 ms   clear     (after both were cleaned up)
```

Load average read 13.0 across all three, unchanged — which is exactly the
argument `headroomFor`'s own docstring makes for ignoring it. **The domain had
that answer and the operator retyped it.**

### The manifest records one pid of three

Measured on a live dispatch, 2026-08-30:

```
plot-dispatch.sh  (99020)
  └── wrapper     (99021)               ← in no manifest
        ├── WorkerMonitor       (99044) ← in no manifest
        ├── AgentMonitor        (99046) ← in no manifest
        └── plot-worker-loop.sh (99048) ← "pid": "99048"
```

At that moment the estate held **1 manifest, 76 monitor processes, 0 of them
nameable from the registry**. `DESIGN-agent.md` gives the registry the invariant
*every agent has a worktree, and no worktree is left behind* — the same sentence
is owed for processes, and today nothing that reads the registry can find one to
reap.

## Design

### `isFree` joins the count; it does not replace it

**The obvious move is wrong, and the code says why.** `liveAgentCount`
deliberately counts a live agent whose branch has merged:

> *Measured 2026-08-25: eleven workers whose branches had merged sat at zero CPU
> for up to ten hours, none counted against the cap. The "liveness takes two
> facts" rule inverted the defect: it excluded landed agents and let the fleet
> grow unbounded.*

**Both are right, because they answer different questions:**

| question | answered by | what it protects |
|---|---|---|
| does this agent **consume a machine**? | `liveAgentCount` | the cap, against unbounded growth |
| can this agent **take a slice**? | `isFree` | dispatching to someone who can work |

A landed-branch agent is **occupied** (it holds CPU, memory, a worktree) and
**free** (it can take the next slice). Replacing one with the other reintroduces
a measured defect, so this plan adds a reader and changes no arithmetic.

### What a dispatch then says when it cannot proceed

| | today | after |
|---|---|---|
| every slot taken, all working | *at the cap* | *at the cap* |
| every slot taken, all idle-between-units | *at the cap* | **a free agent exists — dispatch to it** |

**That is the whole user-visible win.** An agent asking `--next` is `running`
with no branch and is available *now*, and the fleet currently waits for a slot
instead of using it.

### `.plot-worker.wrapper.pid` names the dispatcher, not the wrapper

**Measured 2026-08-30 on all three live workers.** The file the Recording slice
would build on records the wrong process:

```
worktree                                      wrapper.pid   agent's real ppid
bug-a-monitor-ends-with-its-agent                    7357              7358
feature-fleet-settings-is-not-fleet-control         71953             71954
infra-one-rule-decides-what-is-reapable             92947             92949
```

`7357` is `plot-dispatch.sh` itself. The wrapper is `7358`, and it is the one
holding all three children:

```
7357  plot-dispatch.sh            ← what the file records
  └── 7358  sh -c "…monitors…"    ← the actual wrapper
        ├── 7364  WorkerMonitor
        ├── 7365  AgentMonitor
        └── 7366  plot-worker-loop.sh
```

**The cause is one pair of parentheses** (`plot-dispatch.sh:626`):

```sh
… >"$log" 2>&1 </dev/null & echo $! >"$wt/.plot-worker.wrapper.pid" )
```

`echo $!` runs **inside** the enclosing `( … ) &`, so it reports that subshell's
last background pid rather than the `nohup sh -c` within. Reproduced minimally:

```
( sleep 30 & echo "innen: $!" ) & echo "aussen: $!"
  aussen: 85674
  innen:  85675
```

**The intent is documented and unambiguous** — `plot-dispatch.sh:484` says *"The
wrapper's own pid is KEPT … because the wrapper is what writes
`.plot-worker.exit`."* The comment describes what the file is for; the line
below writes something else.

**Why this belongs to the Recording slice.** That slice records the processes
the registry started, and the only existing record of the wrapper points at the
wrong one. Extending a wrong field is worse than adding a right one: a reap
built on it would signal `plot-dispatch.sh` while the wrapper and its monitors
carry on.

**It is a one-line fix and it must not be folded in silently.** Correcting it
changes what an existing file means, so it needs its own assertion —
`.plot-worker.wrapper.pid` names the process that is the agent's parent — and
that assertion is checkable against a live dispatch.

### The manifest carries a process group

`pid` becomes the agent's process plus the processes the registry started
alongside it. **The shape is deliberately not decided here** — a list, a
process-group id, or named fields are all workable, and which survives depends
on what a reap rule needs. What is decided:

- **the registry writes it**, because the registry is what spawned them
- **it is written at spawn**, not discovered later by scanning `ps` for a
  pattern — pattern-matching processes is how `plot-reap.sh:162` came to
  recognise no worktree at all
- **an old manifest without it stays readable**; the field is additive

### Not chosen: reap the monitors in this plan

Naming the processes makes reaping *possible*; deciding when a monitor must die
is a lifetime question `two-monitors-watch-the-agent` owns and has already
recorded as unexplained on one path. Shipping the field without the sweep is a
complete step: the registry stops lying about what it started.

### Not chosen: a worker pool

Raised and withdrawn by the operator the same day. A worker is a relation — the
process an agent runs on a machine — so an idle worker with no agent is not
unpaired but absent (`DESIGN-agent.md` §*Agent and Worker are one entity*).

## Slices

### Asking (Branch: feature/a-dispatch-asks-for-a-free-agent)

`planAutoDispatch` reads `isFree` beside `liveAgentCount`, and its refusal
distinguishes *no slot* from *no free agent*.

**Done when** a fleet at the cap whose agents are all between units dispatches
rather than refusing; a fleet at the cap whose agents all hold unmerged branches
still refuses; `liveAgentCount`'s arithmetic is **unchanged**, asserted by its
existing tests staying green untouched; and the refusal names which of the two
it is.

**Half of `isFree` is currently unreachable, and that is not this slice's to
fix.** Its first condition is `agent.branch === ''` — an agent between units.
Measured 2026-08-30: no worker in this repo has ever hopped, because the 3600s
`Worker bound` kills every agent mid-run (seven that day, all with commits), and
`update_manifest_on_hop` sets `manifest.branch` to the next branch rather than
clearing it, so even a hop would not pass through the empty state.

**So wire both conditions and assert `sliceHasMerged` against reality**; assert
`branch === ''` against a fixture and say in the PR that no live estate produces
it yet. [`a-working-agent-is-not-a-hung-one`](2026-08-30-a-working-agent-is-not-a-hung-one.md)
is what makes it reachable. **Neither plan blocks the other** — this one gives
the state a reader, that one gives the reader a state.

**The regression to lock:** an agent whose branch merged still counts toward the
cap. That is `bug/a-landed-branch-still-holds-a-slot`, measured 2026-08-25, and
a test must fail if this slice re-inverts it.

### Asking the machine (Branch: feature/a-dispatch-asks-the-machine)

`planAutoDispatch` asks `hasRoomToDispatch` before starting, through the
existing `machine-system` adapter.

**Where it goes is decided:** `auto-dispatch.ts:229` and `:527` compute
`budget = parallelAgents - (liveCount + inFlight)`. The machine question sits
beside that, in the same function the Asking slice gives `isFree` — a dispatch
asks two things, *is an agent free* and *has the machine room*, and both belong
where the budget is already computed.

**Done when** the sampling is **time-bounded**, asserted against a stubbed slow
process port — a measurement over a 287 ms/fork machine must return within its
budget rather than after `samples x 287 ms`; a `starved` reading defers a
dispatch and **names its number**;
a `clear` or `tight` reading dispatches; an `unmeasured` reading dispatches
(**silence is never a refusal** — `measuredAt` is required, and a reading nobody
can date is `unmeasured`); the deferral is **overridable**, because
`DESIGN-machine.md` §10 makes this a deferral and not a veto; and the sampling
cost is bounded so the observer does not become the load it measures.

**The message must carry the measurement.** *"not yet: spawn cost 287 ms against
a clear reading of 4.8 ms"* is answerable; *"too much load"* is not, and load
average is explicitly not the verdict.

**The sampling bound is the hard part, and the adapter has none.** `machineSystem`
takes `samples` and loops **sequentially**, with no maximum and no abort:

```ts
for (let taken = 0; taken < samples; taken += 1) {
  const run = await runProcess('git', PROBE, { cwd: context.repoRoot });
```

So the measurement's cost scales with the very thing it measures:

```
                clear (4.8 ms)   tight (21 ms)   starved (287 ms)
samples=5           0.02 s          0.10 s           1.44 s
samples=20          0.10 s          0.42 s           5.74 s
samples=100         0.48 s          2.10 s          28.70 s
```

**`DESIGN-machine.md` §*The observer must price itself* costs this at 374 ms for
100 spawns — but that figure was taken on a clear machine.** On a starved one
the same call is **77× more expensive**, and it is spent precisely when the
machine has nothing to spare. That is the story's own complaint reproduced by
its fix.

**So the sampling is bounded by time, not by count.** Sample until either
`samples` readings are taken **or** a millisecond budget is spent, and report
what was actually taken — a reading from three forks is still a reading, and
`sampleMs` already exists to say what it cost. A count-bounded loop on a starved
machine is the one case where measuring makes the answer worse.

**This is the slice's real work.** Wiring an existing function to an existing
call site is small; the bound is what makes it safe, and no test in
`machine.test.ts` covers it today.

**The regression to lock:** `headroomFor` must keep ignoring load average. A
test that feeds a high load average with a low spawn cost and expects `clear`
fails if someone later "improves" the verdict by consulting it — the failure
this repo already measured twice.

### Recording (Branch: feature/a-manifest-names-every-process)

The manifest records the processes the registry spawned, not one of them.

**Done when** `.plot-worker.wrapper.pid` names the agent's actual parent —
asserted against a live dispatch, since three of three were wrong on
2026-08-30 — and a dispatched agent's manifest names its wrapper and both
monitors as well as its own pid; a manifest written before this change still parses and
reports the group as unknown rather than empty (**absent is not none**); the
board renders unchanged; and the field is written **at spawn**, asserted by
killing the agent and finding the group still recorded.

## Done when

1. `isFree` has a production caller, and the two counts stay distinct.
1b. `hasRoomToDispatch` has a production caller, and a starved machine defers
   with its number rather than refusing silently.
2. The 2026-08-25 cap defect has a regression test that fails if it returns.
3. A live manifest names every process the registry started for that agent.
4. An old manifest without the field still parses.
5. `pnpm test`, `pnpm run typecheck`, `pnpm run test:board`, `pnpm run test:e2e` green.

## Notes

Cut from four spec revisions on 2026-08-30 (`DESIGN-machine.md` §7/§10,
`DESIGN-agent.md` §*Agent and Worker are one entity*). The specs settled the
model; this is the smallest pair of changes that makes the code agree with it.

The measurements were taken while three workers hit the 3600s bound in one
afternoon — the fleet was busy, which is exactly when a free agent going unused
costs something.

# The registry owns what it started

> A dispatch asks for a free agent, and the registry can name every process it spawned.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
-->

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

**The regression to lock:** an agent whose branch merged still counts toward the
cap. That is `bug/a-landed-branch-still-holds-a-slot`, measured 2026-08-25, and
a test must fail if this slice re-inverts it.

### Recording (Branch: feature/a-manifest-names-every-process)

The manifest records the processes the registry spawned, not one of them.

**Done when** a dispatched agent's manifest names its wrapper and both monitors
as well as its own pid; a manifest written before this change still parses and
reports the group as unknown rather than empty (**absent is not none**); the
board renders unchanged; and the field is written **at spawn**, asserted by
killing the agent and finding the group still recorded.

## Done when

1. `isFree` has a production caller, and the two counts stay distinct.
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

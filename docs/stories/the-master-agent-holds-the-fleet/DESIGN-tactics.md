---
title: The four shapes a dependency takes
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-09-07
updated: 2026-09-07
---

# The four shapes a dependency takes

Companion to [DESIGN-entities.md](DESIGN-entities.md), which settles what a domain object is. This settles **what sits between a domain object and the world it came from** — and it is a naming decision before it is a structural one.

## The finding

**Measured 2026-09-07: `Repository`, `Factory` and `Aggregate` appear zero times in `packages/domain/src`.** The four hits for *Repository* are `isRepository` — *is this a git checkout* — a different word.

**All four shapes are in use.**

| pattern | what it already is here | example |
|---|---|---|
| **Repository** | reads and writes a whole entity by identity | `plan-store`: `readPlan`, `readPlans`, `listPlans` — **no caller composes a path** |
| **Service** | reaches a remote system that has an account, a budget and a transport | `host`, `tracker` — the connector kind [CLAUDE.md](../../../CLAUDE.md) already separates from other adapters |
| **Factory** | constructs an entity that did not exist | `host.prCreate`, `trees.add` |
| **Aggregate** | an entity that owns others and is loaded whole | `Plan` owns `Slice[]`; a slice is never fetched alone |

**So this document names four patterns rather than introducing them.** Nothing here asks for a rewrite; it asks that the shape a port already has be visible in what it is called.

## Why the names matter, measured

**`scripts` carries `planMeta`, `config`, `host`, `start` and `stream`** — a repository read, a settings read, a service call and a process launch, in one interface.

**A caller holding `scripts` can reach anything**, so nothing at a call site says which kind of dependency was crossed. That is how, in `packages/board/src` outside `adapters/`, there came to be **132 filesystem calls, 19 spawn sites and 7 files naming a `plot-*.sh` directly** — behind a boundary that looked gated, because the gate counted syscalls and a helper makes a script invisible to that count.

**The name is the constraint a type cannot express otherwise.** A controller holding an `AgentRepository` can read agents. One holding `scripts` can do anything, and did.

## The four, defined for this estate

### Repository — a stored entity, by identity

**Returns whole entities and takes whole entities.** `readPlan(slug)` and not `readFile(path)`.

**The test:** can a caller use it without knowing where the thing lives? `plan-store` passes — nothing outside it composes a plan's path. A `Files` port with `read(path)` fails by construction, which is why one is not proposed: it would move 132 calls one layer down and leave every caller still spelling `PLOT-BLOCKED`.

**Where the path lives:** in the adapter, once. **The path is the leak, not the syscall.**

### Service — a remote system with an account

**Has credentials, a rate limit and a transport choice.** CLAUDE.md's connector kind is exactly this, and the distinction is already load-bearing: of nine adapters, `host` and `tracker` are services and the other seven reach the local machine, where none of those exist.

**A service owns its own budget and its own refusal.** Two services are two accounts — which is why the tracker was split out of the host, and why the build pipeline is being split out next.

**`unaskable` is a service's answer**, not an error. A repository that cannot read a file has failed; a service that cannot be reached has answered.

### Factory — construction, not retrieval

**Makes an entity that did not exist and returns it.** `prCreate` and `trees.add` are the two here.

**It is separate from a repository on purpose.** A repository that also creates hides which callers change the world — and in this estate that matters more than usual, because several ports are read-only by design and their refusals say so.

### Aggregate — loaded whole, written whole

**An entity that owns others, where the children have no independent life.** `Plan` owns `Slice[]`: a slice belongs to exactly one plan, is never fetched alone, and is meaningless without the plan's state.

**The repository returns the root, never a child.** If a caller legitimately needs a child without its parent, they are not one aggregate — that is a measurement about callers, not a preference.

**Not everything with a list is an aggregate.** A `Wave` holds slices drawn from several plans and persists nowhere; it is a cohort, not a root.

## What this rules out

**A port named for its technology.** `Files`, `Processes`, `Network` describe how, not what. `processes` survives as a name because it answers questions *about a process* — `isAlive`, `uptimeSeconds` — which is the thing itself.

**A port that mixes shapes.** `scripts` is the counter-example and the reason for this document. Splitting it is a migration this design does not schedule, but a new port must not repeat it.

**A pattern chosen before the callers are read.** Whether `Agent` is an aggregate root — owning its desk, worker, question and ending — is answered by whether those are read together. **Decide by measuring, and state the measurement.**

## What this does not settle

**The migration.** 132 filesystem calls do not move because a document says so. [`the-outer-boundary-is-a-port`](../../plans/2026-09-07-the-outer-boundary-is-a-port.md) carries the gate and the first repository; the rest is a ratchet.

**Whether `scripts` is split.** It mixes four shapes and that is recorded here as a finding. Splitting it touches every board controller and needs its own plan.

**The vocabulary's edges.** Value objects, domain events and specifications are DDD's other tactical patterns and are not claimed here. **Four are named because four are in use**; a fifth arrives when something in this estate is one.

# Monitoring is a domain concept

> A monitor is a domain object the pulse can trigger, not a script that sleeps.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

Monitors become domain objects: a pure `sample(previous, readings)` that returns
a finding, with the measuring behind the existing `Processes` and `Trees` ports.
The loop that used to sleep becomes a caller.

## Motivation

### The operator's argument, 2026-08-30

> *All monitors need to be part of the domain. That means monitoring is a domain
> concept. **How else can the pulse trigger them?***

**That question is the whole plan.** A monitor that owns its own `sleep` cannot
be triggered by anything — it decides when it wakes. Making the pulse the clock
means the monitor stops holding a clock, and a thing with no clock and a rule is
a domain object.

### The seam already exists inside the script

`plot-worker-monitor.sh` separates its four measurements from its one decision,
and the names say so:

```
monitor_pid_alive()         → 0 alive | 1 dead | 2 unknown
monitor_activity(pid)       → working | idle | ""
monitor_tree_fingerprint()  → an opaque string; unchanged means unchanged
monitor_has_commits()       → 0 yes | 1 no | 2 unanswerable
```

**Those are readings.** What turns them into `idle` is the two-sample rule —
*this pass quiet, the previous pass quiet, the tree unchanged between them, and
commits already on the branch*. **That is a judgement**, and it is the only part
that has to be a domain rule.

### Three of the four readings already have ports

| reading | port | status |
|---|---|---|
| pid alive | `Processes.isAlive(pid)` | **exists** |
| worker state | `Processes.workerState(worktree, hasPr)` | **exists** |
| tree clean / markers | `Trees.isClean`, `Trees.markers` | **exists** |
| **CPU activity** | — | **missing** |
| **tree fingerprint** | — | **missing** |

**So this is two port operations and a rule**, not a rewrite. `DESIGN-ports.md`
already frames widening this way: *"the specification for widening it is the
list of things people went around it for."*

### And one monitor is on the wrong side of the layering rule today

The PR refresh polls every 60 s at `fleet.ts:2452` — **12x the pulse** — and
`fleet.ts` reaches `plot-host.sh` **11 times directly**, past the adapter the
domain already has. It is a monitor in everything but name.

## Design

### A monitor is a pure function of two samples

```ts
sample(previous: Reading | null, current: Reading): Finding | null
```

**No clock, no sleep, no I/O.** The caller supplies both readings; the monitor
says what holds. That makes `idle`'s two-sample rule unit-testable without
waiting 60 s, which is what it costs today.

### Where the memory lives, and why it is the caller's

The monitor's own help states the constraint: *"a single pass can never publish
`idle` — that needs two."* A pulse-driven monitor started fresh each beat has no
memory.

**So the previous reading is an argument, not a field.** The caller — the loop,
or whatever the pulse triggers — holds it. That keeps the domain object pure and
puts the state where the clock is.

### The scripts stay, and stop deciding

This is Manifesto Principle 3 applied one level down: **scripts collect and
report; the rule interprets.** `plot-worker-monitor.sh` keeps its four
measurement functions and loses `monitor_pass`. It becomes an adapter, which is
what its measurements always were.

**Not a rewrite in another language.** The measurements are `ps`, `git` and
`kill -0`; shell is the right tool and stays.

### Not chosen: make the monitor an object with state

A monitor holding its previous reading is the shape that forces it to own a
loop — and owning a loop is what makes it untriggerable. **The statelessness is
the point**, not an implementation preference.

### Not chosen: move the cadence in this plan

*When* a monitor samples is the pulse's question, and the pulse has no entity
yet. This plan makes monitors triggerable; **what triggers them is the follow-on
`the-board-decides-nothing` names.** A monitor that can be called by anything is
useful before a clock exists to call it.

## Slices

### Sampling (Branch: feature/a-monitor-is-a-pure-rule)

The WorkerMonitor's two-sample rule becomes a domain function; the script keeps
its measurements and calls nothing.

**Done when** `sample(previous, current)` is in `packages/domain/src/rules/`,
unit-tested at the package threshold with **no sleeping**; every finding the
script publishes today is reproduced by the rule against the same readings;
and `monitor_pass`'s judgement is gone from the shell.

**The regression to lock:** an agent with **no commits** is never `idle`. That is
the monitor's middle row, and the condition most easily lost when a rule moves
languages.

### Measuring (Branch: feature/the-ports-read-activity-and-trees)

`Processes` gains a CPU-activity reading; `Trees` gains a fingerprint. Both are
what the shell already computes.

**Done when** both operations exist with adapters, tested against the real
estate; the shell functions are their implementations rather than a second copy;
and **a `PortResult` distinguishes *cannot answer* from *no*** — `monitor_activity`
already returns `""` for unknown, and collapsing that into `idle` is how a
monitor invents a stall.

### Asking (Branch: feature/the-pr-monitor-asks-through-a-port)

The PR refresh becomes a monitor: a domain rule over host readings, asking
through the `Host` port instead of `plot-host.sh` directly.

**Done when** no `plot-host.sh` call remains in `fleet.ts`; the cadence and
back-off are unchanged in behaviour; and **the rate policy's home is stated** —
`the-board-decides-nothing` draws that line and this slice follows it rather
than deciding alone.

## Done when

1. No monitor owns a `sleep`; each is callable with two readings.
2. The two missing port operations exist, with adapters.
3. `fleet.ts` reaches no script directly.
4. Every finding published today is reproduced by a domain rule.
5. `pnpm test`, `pnpm run typecheck`, `pnpm run test:e2e` green.

## Notes

Cut 2026-08-30 from the operator's question — *how else can the pulse trigger
them?* — which is an argument rather than a preference: a thing that owns its
clock cannot be driven by one.

**It does not need the pulse to land first.** A stateless monitor is testable,
callable and better the day it exists; the clock is what `the-board-decides-nothing`
follows on with.

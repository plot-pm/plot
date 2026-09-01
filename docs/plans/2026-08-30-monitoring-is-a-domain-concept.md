# Monitoring is a domain concept

> A monitor is a domain object the pulse can trigger, not a script that sleeps.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-09-01, Jan Wloka, `feature/a-monitor-is-a-pure-rule`

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
| **CPU activity** | `ProcessReading.activity` | **exists** — see below |
| tree clean / markers | `Trees.isClean`, `Trees.markers` | **exists** |
| **tree fingerprint** | — | **missing, and it is a composition** |

**Corrected 2026-08-30 while challenging this plan.** A first draft listed CPU
activity as missing. It is not: `ProcessReading` already carries
`activity: WorkerActivity` — *"whether a running worker's descendants are
burning CPU"* — which is exactly what `monitor_activity` computes.

**So this is ONE port operation and a rule**, not two and a rule. The plan was
overstating its own size.

**And the one that is missing is a composition, not a reading.**
`monitor_tree_fingerprint` is `rev-parse HEAD` plus a filtered
`status --porcelain`:

```sh
head=$(git -C "$worktree" rev-parse HEAD)
status=$(git -C "$worktree" status --porcelain)   # then dirty-filtered
printf '%s\n%s' "$head" "$status"
```

**Both halves are reachable through existing ports** — `Refs` for the head,
`Trees` for the status — but the *combination* is not, and neither is the dirty
filter that decides which changes count. **So the question is where the
composition lives**, and it has a clean answer: **the rule composes it.** A
domain function taking a head and a status can produce the fingerprint itself,
and then no new port is needed at all.

**That is worth settling in the slice rather than assuming**, because it decides
whether this plan touches `ports/` at all.

### One signature to look at while moving

`workerState(worktree, hasPr)` takes **`hasPr`** — a host fact, passed into a
process port. It is documented (*"refines `finished`"*) and it works, but a
monitor calling it has to know a PR exists before it can ask what a process is
doing. **Not this plan's to change**; named because a slice that meets it will
otherwise wonder whether it is a defect.

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

### The cadence belongs to `the-pulse-is-an-entity`, which lands first

**Settled 2026-09-01.** Both plans carried the deferral below, so neither owned
the seam. The pulse takes it: one clock per machine is the more fundamental
correction, and `a-machine-is-an-instance` settled the identity it beats on.

**The channel they need already exists.** #584 shipped
`adapters/channel/channel-socket.ts`, and `entities/channel-message.ts` carries a
`HeartbeatSchema` whose fields are *"which monitors have been heard from, and
when each last spoke"*. The pulse's Ticking slice therefore covers monitors as
channel subscribers, and this plan's *Asking* slice adapts to a tick that
arrives rather than building the transport.

**This plan's first two slices need no clock at all** — a monitor becomes a pure
function of two samples, and the ports learn to read activity and trees. Those
can proceed while the pulse is built. Only *Asking* meets it.

**And the sleep is not where this plan's premise implies.** Neither
`plot-agent-monitor.sh` nor `plot-worker-monitor.sh` calls `sleep`: the wait
lives once, in `plot-monitor-subject.sh:189` (`plot_monitor_wait`), shared by all
three monitors. **That makes the change smaller than "rewrite three scripts"** —
one harness function is what a tick replaces.

**The lifetime consequence is the pulse's to carry**, and it is recorded there: a
pulse-ticked monitor cannot be a child of the worker it watches, so
`plot-dispatch.sh:558`'s *"every worker is born monitored, and that is enforced
here or nowhere"* needs a replacement gate before the pulse's Waiting slice
lands.

### Not chosen: move the cadence in this plan

*When* a monitor samples is the pulse's question, and the pulse has no entity
yet. This plan makes monitors triggerable; **what triggers them is the follow-on
`the-board-decides-nothing` names.** A monitor that can be called by anything is
useful before a clock exists to call it.

## Slices

### Sampling (Branch: feature/a-monitor-is-a-pure-rule, PR: #610)

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

**Settle whether any port changes at all.** CPU activity already exists as
`ProcessReading.activity`; the fingerprint is a composition of a head and a
status, both already reachable.

**The likely answer is that the rule composes it** and `ports/` is untouched —
in which case this slice is a paragraph in the first slice's PR rather than a
branch, and **saying so is a finished slice.**

**Answered 2026-09-01, before approval: the rule composes it, and no port
changes.** `monitor_tree_fingerprint` (`plot-worker-monitor.sh:294`) is exactly
two readings joined by a newline —

- `git rev-parse HEAD` → `Refs.resolve('HEAD')`
- `git status --porcelain`, passed through `plot_worker_dirty_filter` →
  `Trees.markers(path, prefix)`, which is the same prefix filter

and the filter is not incidental: *"a fingerprint over raw `git status` would see
the monitor's own file appear"* — a monitor watching a desk it writes to. The
port already applies it, so composing through `Trees.markers` preserves the
property rather than re-implementing it.

`ProcessReading.activity` (`ports/processes.ts:26`) already carries the CPU
reading. **So this slice closes with no code**, as its own text allowed for, and
the argument above is the deliverable — fold it into the Sampling PR.

**Done when** the composition question is answered in writing: either the rule
composes the fingerprint from existing ports — and this slice closes with no
code — or a port gains one operation, with the reason it could not be composed.

**If a port does change:** the shell function is its implementation rather than a
second copy, and **a `PortResult` distinguishes *cannot answer* from *no*** —
`monitor_activity` already returns `""` for unknown, and collapsing that into
`idle` is how a monitor invents a stall.

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

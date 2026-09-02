# The pulse is an entity

> One clock beats on a machine; every active poller names its divisor.

## Status

- **Phase:** Delivered
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Delivered:** 2026-09-02
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-09-01, Jan Wloka, `feature/the-scan-reads-a-fleet-reading`
- **Started:** 2026-09-01, Jan Wloka, `docs/the-pulse-has-a-design`
- **Started:** 2026-09-02, Jan Wloka, `feature/an-agent-waits-instead-of-asking`

## Changelog

`Pulse` becomes an entity with a DESIGN document: a clock that runs on a machine
and ticks the things that actively poll, each naming how many beats it waits.

## Motivation

### A load-bearing concept nobody wrote down

The story defines `Machine`, `Agent`, `Slice`, `Worktree`, `Plan`. **It says
nothing about the pulse.** The domain exports `FleetPulseSchema` and a type — a
shape. The beat itself is `setInterval` at `fleet.ts:2447`, inside the board.

**The operator named what it actually is, 2026-08-30:**

> *The pulse is a core domain concept, which basically is the **master clock** in
> our system. This cannot be part of the board. **This thing runs on a machine.**
> The pulse is the clock that starts ticking for everything actively polling.*

### The three cadences are already one clock

Measured 2026-08-30:

```
pulse          5 s    1x     fleet.ts:67
monitor       30 s    6x     plot-worker-monitor.sh:165
PR refresh    60 s   12x     fleet.ts:83   (2x monitor)

remainders:  30 % 5 = 0    60 % 5 = 0    60 % 30 = 0
```

**Every remainder is zero**, across three numbers chosen independently in two
languages. **A clock does not need many frequencies — it beats once and each
subscriber names its divisor**, and every current consumer already has an
integer one.

### What it buys the master agent

Today a worker asks and leaves:

```sh
next_branch=$(plot-fleet-scan.sh --next "$PLOT_SLUG") || break
```

If the next slice is still blocked, `--next` returns nothing and **the worker
ends**. Reaching the following slice needs a fresh dispatch — worktree, claim,
warm-up — and every ask costs **18.3 s of scan, 12.7 s of it in git**.

| | today | with a clock and a channel |
|---|---|---|
| *is my predecessor merged?* | 18.3 s, asked by each asker | one message when it happens |
| slice blocked | worker ends | worker waits, then hops |
| ten agents asking | 10 x 18.3 s | one beat, ten subscribers |

**The hop already exists** (`plot-worker-loop.sh:260`) and is unreachable
because `--next` answers *nothing* at the moment it is asked. **A subscription
turns "nothing free" into "not yet."**

## Design

### A Pulse runs on a Machine, like a Worker does

`DESIGN-machine.md` settles the parallel: *"A Worker is the process an Agent
runs on a Machine."* A pulse is the same kind of thing — **something that exists
on a machine and can be observed there.** That is why it is an entity and not a
setting.

**One machine, one pulse** is the *target*, and it is **not** what runs today.
Measured 2026-08-30:

```
const caches = new Map<string, CacheEntry>();        fleet.ts:646
function cacheKey(opts) {                            fleet.ts:648
  return `${opts.repoRoot}\0${opts.scriptsDir}`;
}
```

**A timer pair per repository**, created by `ensureCache`. Two boards serving
two repos on one laptop are two clocks, and nothing makes them agree.

**Settled by the operator 2026-08-30, in two statements that only look
contradictory:**

> *We cannot have several on one machine.*
> *But we can start three machines on one computer.*

**So a Machine is a Plot instance, not the hardware.** One pulse per machine;
several machines per computer; the computer is shared and belongs to nobody.

**That makes the cache key correct rather than a defect.** `repoRoot +
scriptsDir` (`fleet.ts:648`) is exactly what distinguishes one instance from
another — `hostname()` cannot, because three instances on a laptop return the
same string. **A first draft of this section called the key an artefact to
remove; it is the machine's identity and it stays.**

**And `DESIGN-machine.md` needs a correction this plan should not make alone.**
It reads:

> *A Machine has no identity, because there is exactly one… That singularity is
> load-bearing: if there were two, headroom would be a property of a pair and
> the whole entity would need a key.*

**Three instances on one computer is exactly that case.** The spec already
carries the resolution without naming it:

> *headroom is not **this fleet's** headroom, it is **the machine's**, and the
> fleet is one tenant among several.*

**Read against three instances, "the machine" there means the hardware.** Three
Plot instances share one spawn cost; each measuring it separately measures the
same number and calls it its own. **So headroom belongs to the computer and
identity belongs to the instance** — and `Machine.hostname()`, which the port
already declares, cannot tell them apart.

**The Naming slice records this; changing `DESIGN-machine.md` is its own plan.**

### Subscribers name a divisor, not a frequency

```
subscribe(everyNthBeat: 1)    the scan
subscribe(everyNthBeat: 6)    a monitor
subscribe(everyNthBeat: 12)   the PR reader
```

**This is what keeps the monitor plan's argument intact.** It holds 30 s because
*"a CPU delta over two samples 0.4 s apart says whether a process is busy now,
which is noise on its own"* — a divisor preserves that reasoning exactly, where
one shared frequency would destroy it.

### Independent failure is a requirement, not a detail

`fleet.ts:2449` records why the two timers were split:

> *Its own timer, because its own clock: git is local and free at 5 s, the host
> is metered and pointless below a minute. **They failed independently already;
> now they also fire independently.***

**A shared clock must not re-couple them.** A subscriber that throws, hangs or is
rate-limited **cannot delay or skip another's beat** — that is the failure the
split was introduced to fix, and re-introducing it would be this plan making
things worse.

### What the pulse does NOT tick

**Watchdogs.** `exitWithParent` (`lifetime.ts:116`) checks whether its own parent
is alive. It must keep running when the pulse stops — a watchdog that dies with
its subject is not one.

**The browser client.** `App.tsx` polls at `FLEET_POLL_MS = 4_000` — **not a
multiple of 5 s**, deliberately faster than the server so it never misses an
update. It runs in another process, often on another machine. Ticking it means
sending beats over the wire, which makes the pulse an API rather than a clock.

**And the process-tree framing does not survive measurement either.** A monitor
runs inside its worker's wrapper; the pulse runs inside the board. **They have
never shared a parent.** Measured 2026-08-30: 32 monitor processes alive, every
one `ppid=1`, and **no board process running at all**.

**So "the pulse's own process tree" is the wrong boundary.** The right one is
narrower and has to be said outright: **the pulse ticks subscribers that can
receive a tick.** In-process today; across processes only once the channel
exists, which is `two-monitors-watch-the-agent`'s subject and not this plan's.

**That makes the Ticking slice's scope the scan and the PR reader** — both
already in the board's process — and monitors a follow-on that waits for the
channel. Naming that now prevents the slice from discovering it as a blocker.

**What stays excluded regardless:** watchdogs (`exitWithParent` must outlive the
pulse) and the browser client (another process, often another machine, and
`FLEET_POLL_MS = 4_000` is deliberately not a multiple of 5 s).

### Not chosen: make the pulse a service others call

A clock that is asked *"has it beaten yet?"* is a poll with extra steps. The
point is that subscribers stop asking.

### Not chosen: move the cadence in this plan

Changing 5 / 30 / 60 is a behaviour change with its own risk. **This plan gives
the numbers one owner; it does not retune them.**

## Slices

### `Pulse` already means something else, and the document gives up the word

**Found 2026-09-01, interrogating this plan.** `packages/domain/src/rules/pulse.ts`
exists and means the fleet scan's OUTPUT — `sliceReadings(pulse: FleetPulse)`,
`doubleClaimedBranches`, `pulseLoss`. This plan wants `Pulse` to mean a clock
beating on a Machine. **Two unrelated concepts, one word**, and that is the
`Wave`/`Slice` defect CLAUDE.md already records, about to be repeated.

**The scan's document gives up the word; the clock keeps it.** A clock IS a
pulse; the scan's output is a *reading* of the estate, so `FleetReading` names it
better than `FleetPulse` ever did. The entity work that follows needs the
vocabulary right more than this repo needs a small diff.

**Measured before choosing: 207 references** — 20 in the domain, 64 in the board,
123 in tests, plus 5 shell scripts.

**And one of them crosses a process boundary.** `plot-fleet-scan.sh:3618` emits
`{"kind":"pulse","pulse":{…}}` and `schema.ts:1585` parses it. **The rename is a
wire change, not a type change**: both sides move together or the board stops
reading its own scan. That is why it is a slice of its own, sequenced first —
a find-and-replace across 207 sites would break the stream silently.

### The pulse owns the monitors, and that moves a guarantee

**Settled 2026-09-01, interrogating this plan against the code.** Today three
monitors are born as children of the worker wrapper, and
`plot-dispatch.sh:558` states the property that placement buys:

> EVERY WORKER IS BORN MONITORED, AND THAT IS ENFORCED HERE OR NOWHERE.
> Three monitors start INSIDE the wrapper, as its children, immediately before
> the agent.

**A monitor the pulse ticks is machine-scoped, so it cannot be a child of the
worker it watches.** The decision is that the pulse owns them entirely —
subscribers keyed by worker rather than processes parented to one.

**What that costs, stated rather than discovered later:** the birth guarantee
moves from a wrapper that *cannot* forget — no monitor start, no monitored
worker, and a mutation test says so — to a registry that *can*. Whatever
replaces it has to be a gate, not a rule, or the property is lost in the move.
`the-registry-supervises-its-agents` is where that gate belongs, and this plan's
Waiting slice must not land before it exists.

**The sleep this replaces is in one place**, which is what makes the change
tractable: `plot-monitor-subject.sh:189`'s `plot_monitor_wait`, not in the
individual monitors. Three monitors share one harness, so one call site changes.

### This plan lands before `monitoring-is-a-domain-concept`

Both plans carried *"Not chosen: move the cadence in this plan"*, so the seam
between them was unowned. **The pulse takes it.** One clock per machine is the
more fundamental correction and the identity it needs was settled by
`a-machine-is-an-instance`; monitoring adapts to a clock that exists rather than
the two plans waiting on each other.

### Freeing the word (Branch: feature/the-scan-reads-a-fleet-reading, PR: #600)

`FleetPulse` becomes `FleetReading` and the stream's `kind` moves with it, so the
clock can have the word `Pulse` without two meanings sharing it.

**Done when** the 207 references are one name; **the shell and the board change
in the same commit** — `plot-fleet-scan.sh:3618` emits the `kind` that
`schema.ts:1585` parses, so a half-done rename breaks the stream with no test
failing locally; and `plot-fleet-scan.sh --stream` feeds a running board
unchanged, asserted rather than assumed.

**First, because every later slice writes the word.** A `DESIGN-pulse.md` drafted
while `FleetPulse` still means the scan's output documents a collision instead of
an entity.

### Naming (Branch: docs/the-pulse-has-a-design)

`DESIGN-pulse.md`: fields, lifecycle, its relation to `Machine`, and the divisor
model — written the way the other entity specs are.

**Done when** the document states what a beat is a reading of; why one machine
has one pulse; the three current divisors with their measurements; and
**explicitly what the pulse does not tick, with the reason** — the watchdog and
the client are the cases a later reader will otherwise try to add.

**And it distinguishes the instance from the computer.** One pulse per Machine,
where a Machine is keyed by `repoRoot + scriptsDir`; several Machines per
computer, sharing hardware and therefore sharing headroom. **The document must
say which measurements belong to which** — `spawnCostMs` is the computer's,
`hostname()` cannot separate instances, and the divisors are the instance's.

**The test suite is the proof that several are legitimate**, not a case to
exempt: suites start boards with `PORT=0` in parallel, and each is its own
Machine with its own pulse over its own fixture estate. **A guard refusing them
would be enforcing a rule that was never the rule.**

### Ticking (Branch: feature/a-subscriber-names-its-divisor)

The pulse gains subscribers; the scan and PR reader become two of them.

**Done when** both run at their current effective cadence through divisors 1 and
12; **a subscriber that throws or hangs does not delay another's beat**,
asserted directly; and the payload is unchanged.

**Scope, corrected 2026-09-01: in-process AND channel subscribers.** This slice
was written when monitors could not be ticked *"until a channel exists"*. **It
exists.** #584 shipped `adapters/channel/channel-socket.ts`, and
`entities/channel-message.ts` already carries a `HeartbeatSchema` whose fields
are *"which monitors have been heard from, and when each last spoke"* — which is
a tick over a channel, already specified. `entities/subscription.ts` carries the
`Purpose` a subscriber opens with.

**So the stated blocker is gone, and the earlier scope line contradicted this
plan's own decision that the pulse owns the monitors.** Monitors are subscribers
here, over the channel, alongside the in-process scan and PR reader.

**And the divisor for the PR reader is 12 only if the pulse is 5 s.** If Naming
settles on a per-machine clock with a different base, the divisors move with it;
they are derived, not configured.

**That middle assertion is the slice.** Everything else is a move.

### Waiting (Branch: feature/an-agent-waits-instead-of-asking)

A worker whose next slice is blocked **waits** for a beat that says otherwise,
instead of ending.

**Done when** a worker with a blocked next slice stays alive and hops when the
blocker merges; a worker with **no** next slice still ends cleanly; and the
first case is asserted end to end — **no worker in this repo has ever hopped.**

**That is a claim about FIRING, not about the mechanism.**
`plot-worker-loop.sh:114` increments `wavesCount`, so hopping is implemented and
`the-registry-supervises-its-agents` builds its per-branch envelope on it.
Whether it has ever fired is unobservable from a checkout whose `.plot/agents/`
is empty — which it was on 2026-09-01, with four branches of this repository
claimed by another machine.

**This slice does not land until the registry's monitor gate exists.** It carries
two risks the other two do not: behaviour with no precedent here, and the birth
guarantee that moves when the pulse takes the monitors off the worker wrapper.
`the-registry-supervises-its-agents` owns the replacement gate; until a
registered agent with no live monitor subscription is a *finding*, a hopping
worker can outlive the thing watching it.

## Done when

1. `DESIGN-pulse.md` exists and covers what does *not* tick.
2. One clock; subscribers name divisors; the effective cadences are unchanged.
3. A failing subscriber cannot affect another's beat.
4. A worker waits rather than ending, proven end to end.
5. `pnpm test`, `pnpm run typecheck`, `pnpm run test:board`, `pnpm run test:e2e` green.

## Notes

Cut 2026-08-30 from four operator statements, each of which settled a question
this plan would otherwise have had to ask: the pulse is a master clock on a
machine; it ticks everything actively polling; the ratios are 6x and 12x; and a
monitor must be a domain object or a clock cannot trigger it.

**It depends on `monitoring-is-a-domain-concept`** for the third slice — a
monitor that owns its `sleep` cannot be ticked. The first two slices do not.

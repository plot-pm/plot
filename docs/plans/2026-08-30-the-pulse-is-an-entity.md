# The pulse is an entity

> One clock beats on a machine; every active poller names its divisor.

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

**One machine, one pulse.** `DESIGN-machine.md` makes the machine singular and
calls that load-bearing; a second clock on one machine would make *"when is it"*
a property of a pair.

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

**So the scope is: active pollers in the pulse's own process tree.**

### Not chosen: make the pulse a service others call

A clock that is asked *"has it beaten yet?"* is a poll with extra steps. The
point is that subscribers stop asking.

### Not chosen: move the cadence in this plan

Changing 5 / 30 / 60 is a behaviour change with its own risk. **This plan gives
the numbers one owner; it does not retune them.**

## Slices

### Naming (Branch: docs/the-pulse-has-a-design)

`DESIGN-pulse.md`: fields, lifecycle, its relation to `Machine`, and the divisor
model — written the way the other entity specs are.

**Done when** the document states what a beat is a reading of; why one machine
has one pulse; the three current divisors with their measurements; and
**explicitly what the pulse does not tick, with the reason** — the watchdog and
the client are the cases a later reader will otherwise try to add.

### Ticking (Branch: feature/a-subscriber-names-its-divisor)

The pulse gains subscribers; the scan and PR reader become two of them.

**Done when** both run at their current effective cadence through divisors 1 and
12; **a subscriber that throws or hangs does not delay another's beat**,
asserted directly; and the payload is unchanged.

**That middle assertion is the slice.** Everything else is a move.

### Waiting (Branch: feature/an-agent-waits-instead-of-asking)

A worker whose next slice is blocked **waits** for a beat that says otherwise,
instead of ending.

**Done when** a worker with a blocked next slice stays alive and hops when the
blocker merges; a worker with **no** next slice still ends cleanly; and the
first case is asserted end to end — **no worker in this repo has ever hopped.**

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

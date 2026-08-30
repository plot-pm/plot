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

**Scope: in-process subscribers only.** Monitors run in a different process tree
and cannot be ticked until a channel exists — see the correction above.

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

# Implementation brief — the-pulse-is-an-entity (Naming)

- **Plan (canonical):** `docs/plans/2026-08-30-the-pulse-is-an-entity.md` on main
- **Branch:** `docs/the-pulse-has-a-design` (base: `main`)
- **Ends as:** one PR to main
- **Runs first.** The other two slices build on what this settles.

### What to build

`DESIGN-pulse.md`, written the way the other entity specs are.

**The story defines `Machine`, `Agent`, `Slice`, `Worktree`, `Plan` — and says
nothing about the clock they all live under.** The domain exports
`FleetPulseSchema` and a type: a shape. The beat is `setInterval` at
`fleet.ts:2447`.

### The divisor ladder, measured

```
pulse          5 s    1x     fleet.ts:67
monitor       30 s    6x     plot-worker-monitor.sh:165
PR refresh    60 s   12x     fleet.ts:83   (2x monitor)

30 % 5 = 0     60 % 5 = 0     60 % 30 = 0
```

**Every remainder is zero**, across three numbers chosen independently in two
languages. **A clock needs no frequencies — it beats once and each subscriber
names its divisor.** That preserves the monitor plan's argument for 30 s
(*"a CPU delta 0.4 s apart is noise"*) instead of overriding it.

### What the document must settle

**One pulse per Machine — where a Machine is an instance.** Three Plot projects
on this computer are three machines, each with its own pulse over its own
estate. `fleet.ts:648` keys the cache by `repoRoot + scriptsDir`, which **is**
that identity. See `a-machine-is-an-instance`, in flight.

**Independent failure is a requirement, not a detail.** `fleet.ts:2449` records
why the two timers were split:

> *Its own timer, because its own clock: git is local and free at 5 s, the host
> is metered and pointless below a minute. **They failed independently already;
> now they also fire independently.***

**A shared clock must not re-couple them.** A subscriber that throws, hangs or
is rate-limited cannot delay another's beat — re-introducing that would make
this plan a regression.

**What the pulse does NOT tick, with the reason for each:**

- **watchdogs** — `exitWithParent` (`lifetime.ts:116`) checks whether its own
  parent is alive. **It must keep running when the pulse stops**; a watchdog
  that dies with its subject is not one
- **the browser client** — `App.tsx` polls at `FLEET_POLL_MS = 4_000`, **not a
  multiple of 5 s**, deliberately faster than the server so it never misses an
  update. Another process, often another machine. Ticking it means beats over
  the wire, which makes the pulse an API rather than a clock
- **monitors, for now** — they run in their worker's wrapper and have never
  shared a parent with the board. Measured 2026-08-30: 32 monitor processes
  alive, every one `ppid=1`, and no board running at all. **They become
  tickable when a channel exists**, which is
  `two-monitors-watch-the-agent`'s subject

### Done when

The plan's list. **The exclusions are the part a later reader will try to undo**,
so each needs its reason in the document, not a cross-reference.

Plus: `pnpm test` green — this is a document.

### Scope guard

The document. **No code**, no cadence change, no subscriber. The numbers
5 / 30 / 60 stay exactly as they are; this plan gives them one owner, it does
not retune them.

# Implementation brief — the-pulse-is-an-entity (Ticking)

- **Plan (canonical):** `docs/plans/2026-08-30-the-pulse-is-an-entity.md` on main
- **Branch:** `feature/a-subscriber-names-its-divisor` (base: `main`)
- **Ends as:** one PR to main
- **Depends on the Naming slice** for what a pulse is and what it does not tick.

### What to build

The pulse gains subscribers. The scan and the PR reader become two of them, at
divisors 1 and 12.

```
subscribe(everyNthBeat: 1)    the scan        — 5 s today
subscribe(everyNthBeat: 12)   the PR reader   — 60 s today
```

### Scope: in-process subscribers only

**Monitors are not in this slice.** They run in their worker's wrapper and have
never shared a parent with the board — measured 2026-08-30: 32 monitor
processes, all `ppid=1`, no board running. **Ticking across processes needs the
channel**, which belongs to `two-monitors-watch-the-agent`.

Stated so the slice does not discover it as a blocker halfway.

### The assertion that IS the slice

Everything else here is a move. This is the property:

> **A subscriber that throws or hangs does not delay another's beat.**

`fleet.ts:2449` says why it matters:

> *They failed independently already; now they also fire independently.*

The two timers were **split** because a metered host and a local git failed in
different ways. **A shared clock that re-couples them is worse than today** —
one rate-limited host would stall the git scan that has nothing to do with it.

**Assert it directly:** a subscriber that throws, and one that never returns.
Both must leave the other's cadence untouched. A test that only checks the happy
path proves the divisors and nothing else.

### Done when

- the scan and PR reader run at their **current effective cadence** through
  divisors 1 and 12
- **a throwing subscriber and a hanging subscriber each leave the other
  unaffected**, asserted directly
- the payload is unchanged

**The divisors are derived, not configured.** 12 is right only because the base
is 5 s. If anything changes the base, the divisors move with it — do not write
`60` anywhere.

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm run test:board`, artifact
rebuilt, changeset (`'@plot-pm/board': patch`).

### Scope guard

Two subscribers and the clock they share. Not the monitors, not the browser
client, not the cadence values, not `exitWithParent` — the Naming slice lists
each exclusion with its reason and this slice honours them.

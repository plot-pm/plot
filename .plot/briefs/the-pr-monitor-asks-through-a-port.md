# Implementation brief — monitoring-is-a-domain-concept (Asking)

- **Plan (canonical):** `docs/plans/2026-08-30-monitoring-is-a-domain-concept.md` on main
- **Branch:** `feature/the-pr-monitor-asks-through-a-port` (base: `main`)
- **Ends as:** one PR to main
- **Depends on Sampling** for the shape a monitor rule takes.

### What to build

The PR refresh becomes a monitor: a domain rule over host readings, asking
through the `Host` port instead of `plot-host.sh` directly.

### It exists already, on the wrong side of the layering rule

Measured 2026-08-30:

```
fleet.ts:2452   PR refresh polls every 60 s   — 12x the pulse
fleet.ts        calls plot-host.sh 11 times directly
```

**`CLAUDE.md` § The Layering Rule:** `controller → domain → port ← adapter →
script`. **Scripts can only be called from an adapter implementation.**

**So this slice moves a poller, it does not add one.** The cadence, the back-off
and the gate on whether to ask at all — `prGateOpen`, `prNextDueAt`,
`rateLimitBackoffMs` — are written. What changes is who owns them and that the
asking goes through a port.

### The one thing you must not decide alone

**Does the rate policy move with it?**

*"May I ask the host yet?"* is a statement about a **service**, not about a PR.
`the-board-decides-nothing` draws the line between a verdict (domain) and a
policy (machinery) and is in flight.

**Follow what it settles.** If it has not settled when you get here, **state
your reading in the PR and move only the verdict** — leaving a policy where it
is costs nothing; moving it twice costs a review.

### The failure this must not inherit

`plot-host.sh`'s `pr-list` **does not check `gh`'s exit code**, and the script
runs under `set -uo pipefail` with **no `-e`**. A throttled host yields an empty
list, indistinguishable from *no PRs*. Reproduced 2026-08-30 against a
nonexistent repo: `exit=1`, stdout empty.

**`a-throttled-host-says-so` fixes the adapter** and is approved and briefed.
**Land after it, or state what your monitor does when the list comes back empty
for a reason that is not emptiness.** A monitor that reads a rate limit as *"no
open PRs"* publishes a false finding, which is worse than publishing none.

### Done when

- **no `plot-host.sh` call remains in `fleet.ts`** — 11 today, asserted by grep
- the cadence and back-off are unchanged **in behaviour**
- the rate policy's home is **stated**, and matches whatever
  `the-board-decides-nothing` settled
- an unaskable host does not produce a finding that claims knowledge

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm run test:board`, artifact
rebuilt, changeset.

### Scope guard

The PR poller. Not the scan's timer, not the WorkerMonitor, not the host adapter
itself — `a-throttled-host-says-so` owns that and you consume its result.

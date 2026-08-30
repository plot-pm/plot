## Implementation brief — two-monitors-watch-the-agent (slice 4: The channel)

- **Plan (canonical):** `docs/plans/2026-08-30-two-monitors-watch-the-agent.md` on `main`
- **Branch:** `feature/the-channel-carries-the-findings` (base: `main`)
- **Ends as:** one PR to `main`

Needs slices 1–3. This is the protocol between processes; slice 5 renders what
it carries.

### What to build

A local socket under `.plot/`. Monitors publish; subscribers connect **with a
purpose**.

```
subscribe(purpose: everything)                    the board — until it disconnects
subscribe(purpose: until <condition> holds)       an agent — served once, then ends
```

### The decisions the plan settles — do not re-derive them

**A socket, not HTTP and not a port.** Everything runs on one Machine —
[DESIGN-machine.md](../../docs/stories/the-master-agent-holds-the-fleet/DESIGN-machine.md):
*"There is exactly one Machine"*, *"One machine, and the supervisor is on it."*
So monitor, board and master agent are neighbours, not peers across a network.
HTTP-to-the-board was rejected because it needs a board running — measured
2026-08-30, none was, and seven skills would gain a dependency on a service that
has always been optional. A port is how you reach another machine; there is one.

**The wrapper can reach a filesystem path, and nothing else.**
`plot-dispatch.sh:275` calls it *"a fresh shell that cannot reach"* the
dispatcher — it inherits no descriptors, no environment beyond what is passed.
That constraint decided the transport.

**Channel, not queue.** Findings are current state, not events to replay. A
subscriber joining late gets what is true now.

**The purpose IS the subscription, not a filter on one.** A narrow purpose ends
itself when served; `everything` lasts as long as the listener. **The board's
purpose is the degenerate case**, and that it falls out of the same mechanism
rather than needing its own is what says the shape is right.

**A purpose the monitor does not measure is refused IMMEDIATELY**, naming what
it cannot serve. A subscriber waiting forever on a condition nobody checks is
the original failure wearing a new coat. In particular **CI-is-green is
refused**: no monitor asks the host about a check run, and adding a host
question to satisfy a request is how the five-minute budget stops meaning
anything.

**A purpose dies with its subscriber**, or the monitor accumulates state for
absent listeners it can never discharge.

**The heartbeat is how a dead monitor is visible.** An earlier draft claimed a
dropped subscription would show it — it would not: the monitor **publishes**,
nothing watches its connection, and a publisher that dies quietly looks exactly
like one with nothing to say. So `measuredAt` is required on every message, for
the reason DESIGN-machine.md gives: *"a reading without one cannot be judged
stale."*

**This replaces work being done by hand.** Measured on the session that wrote
this plan: **eight polling loops**, all `for i in $(seq 1 70); ... sleep 30`,
each asking whether CI was green or a PR had merged. Every one would have been a
single subscription.

### Done when

The plan's The-channel `Done when` — all six points. The two that a channel has
to earn: **two subscribers each receive every finding without knowing about each
other**, and **silence-because-healthy is distinguishable from
silence-because-gone**.

**Unit against mocked ports for the protocol; one e2e** proving the boundary —
a real wrapper publishes, a real subscriber receives, and a killed monitor's
heartbeat stops.

Repo gates: `pnpm test`, `pnpm run typecheck`, changeset. Node 24, `corepack pnpm`.

### Scope guard

Owns the socket and the subscription protocol. Not the render (slice 5), not any
action (slice 6). **It measures nothing itself** — it carries what the monitors
measured.

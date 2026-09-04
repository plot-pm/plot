## Implementation brief — the-machine-keeps-the-daemon-alive (slice Watching)

- **Plan (canonical):** `docs/plans/2026-09-03-the-domain-owns-the-agent-lifecycle.md` on `main`
- **Branch:** `feature/the-machine-keeps-the-daemon-alive` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 8 of eight, and the last. **The plan delivers when this lands.**

Its prerequisite merged: `feature/the-registry-supervises-its-agents` landed as #695, so `plot-registryd` and its tick exist. A supervisor worth keeping alive had to exist first.

### What this branch owns

**The launchd/systemd unit**, and **what the daemon does on a tick it cannot complete.**

### The direction is settled, and the spec defends it

`docs/plans/2026-08-31-the-registry-supervises-its-agents.md:330` answers who supervises the supervisor:

> *`launchd` on macOS, `systemd` on Linux. That is the correct owner because "is a process that should be running actually running?" is a machine-side question, and it terminates the regress instead of adding another Plot component to babysit.*

```
launchd/systemd  ── restarts ──►  plot-registryd
plot-registryd   ── spawns   ──►  agents        ── run ──►  workers
```

**Plot's own `Machine` entity is not that supervisor and must not become one.** `DESIGN-machine.md` withdrew a first version that had the machine start idle workers, and the reasoning stands: `Machine "1" --> "*" Agent : hosts` is a **resource relation**. The machine answers *is there room?* via `hasRoomToDispatch` and **initiates nothing**. The daemon asks the machine before spawning; the machine never tells the daemon anything.

If the implementation finds itself giving `Machine` a verb, that is the withdrawn design returning — stop and say so.

### A tick it cannot complete

The daemon is **stateless across restarts by construction** — #695 built it that way, so `kill -9` costs one tick and no state. That is what makes the OS supervisor sufficient: it can restart the process without Plot reconciling anything.

So an incomplete tick needs no recovery machinery. What it needs is to **say what it could not do** and let the next tick re-read. Do not add a journal, a lock file, or a resume path; the statelessness is the design and re-implementing durability would undo it.

### What it does NOT own

**The tick itself.** #695.

**The three bounds, `needs a person`, the reap on success.** All #695.

**Anything that makes `Machine` initiate.** See above — that is the withdrawn design.

### Done when

- A unit file exists for launchd and for systemd, and each is documented well enough that a person can install it without reading the source.
- A tick that cannot complete reports what it could not do; the next tick re-reads and continues, proven by a test rather than asserted.
- Nothing new is persisted between ticks — the statelessness #695 built is intact, and a test says so.
- `Machine` gains no verb.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus` — **the root typecheck covers the BOARD only.**
- `pnpm build:board` run and the artifact committed — a shell-only change still needs it; #687 failed CI's freshness gate for exactly that.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate.

**A corpus floor reading `> 20` is a bug, not your failure.** Three were fixed on 2026-09-04 as delivered plans took the estate below the floor. Fix it to `> 0` and say so.

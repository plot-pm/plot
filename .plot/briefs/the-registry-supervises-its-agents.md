## Implementation brief — the-registry-supervises-its-agents (slice Supervising)

- **Plan (canonical):** `docs/plans/2026-09-03-the-domain-owns-the-agent-lifecycle.md` on `main`
- **Branch:** `feature/the-registry-supervises-its-agents` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 7 of eight, and the one everything else waited on. **`the-registry-queues-a-brief`, on another plan, is blocked until this lands.**

### Read the original spec, not just this

The design is in `docs/plans/2026-08-31-the-registry-supervises-its-agents.md` — a delivered plan whose Supervising slice was **moved here on 2026-09-04**, because a delivered plan dispatches nothing and the branch could never start. That file holds the tick, the bounds and the reasoning; this brief does not restate it.

### The tick

```
read .plot/agents/*.json  +  the desks they name
  for each agent:
    worker alive?            -> nothing to do
    envelope ok?             -> gates pass? reap the desk : correct and resume
    envelope absent/blocked  -> bounds met? resume with correction : mark needs-a-person
```

**It holds nothing in memory it cannot re-read**, so `kill -9` costs one tick. Stateless across restarts by construction — not by discipline.

**One daemon per repo**, supervising only the agents that repo registered.

### The two counters are different, and conflating them is the bug to avoid

`relaunches` counts operator-initiated `--restart`s and is **a human's record**. `attempts` counts the supervisor's own tries and is **what the bound reads**. Conflating them lets a person's three manual restarts exhaust the automatic budget, or the reverse. Both fields already exist on the manifest.

**When the budget is spent, the agent is marked `needs a person`** — a visible stop, which is the failure mode to prefer over a loop.

### What this slice can now rely on, and could not before

Four slices landed tonight that this one needs:

- **`an-agent-declares-what-it-is`** (#679) — the charter. *The registry cannot supervise what it cannot name.*
- **`the-registry-reads-eight-states`** (#686) — `registry.ts` derives from `AgentStateSchema.options`; **do not reintroduce a second list.**
- **`an-ending-carries-its-reason`** (#687) — an ending records reason and actor. The daemon's stops must use that channel, not invent one.
- **`an-agent-knows-what-it-spent`** (#692) — the context reading, per session.

### What it does NOT own

**Keeping the daemon alive.** Slice 8, `feature/the-machine-keeps-the-daemon-alive`, waits on this one.

**The queue and the hand-over.** `feature/the-registry-queues-a-brief` on `an-agent-holds-one-desk`.

**Reaping policy.** `plot-reap.sh` has five refusals and a stated licence. The daemon *calls* the reaper on success; it does not re-implement the guards or relax them.

### Open question the plan left, and you may answer it

**What tick interval?** The plan says: long enough not to compete with the board's 5 s poll, and **measure the tick's own cost first**. Measure it, state the number, and say why.

### Done when

- The tick is implemented as specified, and a test drives each of the four branches.
- `attempts` and `relaunches` are read separately, with a test that a manual restart does not consume the automatic budget.
- A spent budget marks `needs a person` and stops — no loop.
- Killing the daemon mid-tick costs one tick and no state, proven rather than asserted.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus` — **the root typecheck covers the BOARD only.**
- `pnpm build:board` run and the artifact committed.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate.

**A corpus floor reading `> 20` is a bug, not your failure.** Three were fixed on 2026-09-04 as delivered plans took the estate below the floor. Fix it to `> 0` and say so.

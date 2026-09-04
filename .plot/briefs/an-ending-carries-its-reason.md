## Implementation brief — an-ending-carries-its-reason (wave Ending for a reason)

- **Plan (canonical):** `docs/plans/2026-09-03-the-domain-owns-the-agent-lifecycle.md` on `main`
- **Branch:** `feature/an-ending-carries-its-reason` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Wave 4 of eight. An ending gets a reason and an actor.

### The measurement

**`exit 124` means three different things**, and `plot-worker-loop.sh:1022` states it plainly:

> *"An exhausted budget ends the worker the same way an exhausted prompt does — exit 124, the floor's own convention — because it is the same floor."*

So a reader of the exit code cannot tell a prompt that ran past `WORKER_BOUND_SECONDS` from a wait budget that expired with no work to take. `:931`'s `exit 0` is a third ending — the monitor found the agent idle — and it is the only one that carries any meaning at all.

**None of the three says who ended it.** An agent that stopped itself and one a person stopped with `plot-dispatch.sh --stop` are the same record.

### What this branch owns

**A channel beside `.plot-worker.exit`.** The worker writes its reason and the actor to the desk as it ends; the state rule reads it. `_ended_detail` and `_ended_by` do not exist yet — this wave creates both.

**Distinguish at minimum the three endings that exist today**, because they are already three:

| exit | today | reason to write |
|---|---|---|
| `124` at `:1154` | the prompt exceeded the bound | the bound expired |
| `124` via `wait_for_work` at `:1234` | no claimable slice, wait budget spent | no work arrived |
| `0` at `:931` | the monitor found it idle | the monitor said idle |

**A stop is an ending too.** `plot-dispatch.sh --stop` ends a worker and leaves no reason; the actor there is a person, and the record should say so.

**Reason and actor are separate fields.** *What ended it* and *who ended it* are different questions — a bound expiring and a person stopping it can both be `ended`, and a reader needs to know which.

### The measurement this wave answers

**Measured 2026-09-04, one session:** five branches carried workers idling at 0% CPU on work that had already merged — one for **9 hours 41 minutes**, one for 6 hours after stalling with two commits, one for 2 hours after its own PR merged. Each was stopped by hand.

**None of them had a reason to end.** The bound had not expired, the monitor's idle rule had already fired and been ignored, and *"my work merged"* is not something a worker can currently act on or record. This wave does not add that ending — it builds the channel that would let one be stated.

### What it does NOT own

**Spend and session.** Waves 5 and 6.

**The registry terminating agents.** Wave 7, the daemon.

**Deciding to end on a merged PR.** That is a new ending, not a reason for an existing one. Note it in the plan if the work suggests it; do not add it here.

**The eight states.** Wave 3 merged as `cc2df7bc`; `registry.ts` now derives from `AgentStateSchema.options` rather than listing its own. Do not reintroduce a second list.

### Done when

- The three endings above are distinguishable from the record alone, with a test per ending.
- A `--stop` records a person as the actor.
- The state rule reads the channel; no caller re-derives a reason from the exit code.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus` — **the root typecheck covers the BOARD only.**
- `pnpm build:board` run and the artifact committed.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate. Two agents running it here produced 53 concurrent test processes and a board that could not answer in 25 seconds.

**A corpus floor that reads `> 20` is a bug, not your failure.** Three were fixed on 2026-09-04 after five plans delivered took the estate below the floor. If one fails, it is a count tripwire measuring a moving population — fix it to `> 0` and say so.

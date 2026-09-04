## Implementation brief — the-registry-reads-eight-states (wave Agreeing on the states)

- **Plan (canonical):** `docs/plans/2026-09-03-the-domain-owns-the-agent-lifecycle.md` on `main`
- **Branch:** `feature/the-registry-reads-eight-states` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

**Written by the implementing agent on 2026-09-04, from the plan's `Agreeing on the states` wave.** No brief existed at dispatch; the plan's slice text and the four measurements in its Motivation are the specification, and nothing here widens them.

Wave 3 of eight. The registry stops discarding four answers it already receives.

### What this branch owns

`AgentState` (`packages/board/src/server/registry.ts:35`) and `AgentStateSchema` (`packages/board/src/contract/schema.ts:2903`) name five states. `plot-worker-state.sh` answers eight, and `bashLiveness` (`registry.ts:820`) already receives all eight. `KNOWN_STATES` (`registry.ts:43`) then throws four of them — `failed`, `ended`, `none`, `elsewhere` — into `unknown`.

**The registry reads the same eight the scan does**, plus its own `unknown`. Nine members: the domain's `AgentStateSchema` (`packages/domain/src/entities/agent.ts:11`) verbatim, and `unknown` beside them.

`unknown` stays and is not a ninth collapse. It answers a question the shell is never asked: the resolver threw, the answer count did not match, or the entry names no worktree to look in. `none` is *a record says no worker*; `elsewhere` is *this machine has no worktree*; `unknown` is *the board could not ask*. Three different absences, and the board already distinguishes absences everywhere else.

Closes `DESIGN-agent.md:797` — *"The shell and the contract agree on eight; only the registry disagrees."*

### The classifiers must move with the enum, and this is the failure mode

`isLiveState` (`schema.ts:2936`) is a **denylist**: anything but `finished`, `stalled`, `unknown` is live. Widening the enum alone makes `failed`, `ended`, `none` and `elsewhere` read as **live workers** and render in WORKING — the exact defect `the-working-section-shows-every-worker` fixed in the other direction, telling a reader sixteen agents were working when four were.

So both classifiers are part of this slice:

- **Live:** `running` and `waiting` only. Unchanged in meaning; the denylist gains the four.
- **Broken:** `stalled` and `unknown` today. `failed` joins them — a recorded non-zero exit is a worker that stopped and needs a person, which is what WAITING ON YOU says.
- **Neither:** `finished`, `ended`, `none`, `elsewhere`. `finished` drains through its PR, as today. `ended`, `none` and `elsewhere` are each a statement that no worker is here — an agent with no process is not a problem report.

The denylist reading of `isLiveState` is **kept**: an unrecognised tenth state still renders as live, because a worker nobody can see is the worse failure. Only the four named states leave the live side.

### What it does NOT own

**The PR fact.** `bashLiveness` passes `''` deliberately — *"the registry must not be behind anything that can fail"* (`registry.ts:793`). The plan states it stays the caller's to supply. Unchanged here.

**`plot-worker-state.sh`.** It already answers eight. Not touched.

**The domain's enum.** `packages/domain/src/entities/agent.ts` already carries the eight. The board reads them; it does not redefine them.

**`WorkerStateSchema`.** The scan's branch-side vocabulary is already eight and is a different field on a different entity. Untouched.

### Done when

- The board's `AgentStateSchema` carries the domain's eight plus `unknown`, and a test asserts the eight are exactly `AgentStateSchema.options` from `@plot-pm/domain`, so the two cannot drift again.
- **One agent reads one state:** a test hands the registry each of the eight shell answers and asserts the entry carries that answer, not `unknown`.
- `isLiveState` is true for exactly `running` and `waiting` over the whole enum; `isBrokenState` is true for exactly `stalled`, `failed` and `unknown`.
- The two tests that pin the enum at five (`schema.test.ts:263`, `working-agents.test.ts:50`) are updated to pin the new size, and `idle` is still not a member.
- Green: `pnpm test`, `pnpm run test:board`, `pnpm run typecheck`, and `cd packages/domain && npx tsc --noEmit`.
- `pnpm build:board` run and the artifact committed.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate.

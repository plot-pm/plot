## Implementation brief — the-board-loop-reads-the-same-ceiling

- **Plan (canonical):** `docs/plans/2026-09-15-the-board-loop-reads-the-same-ceiling.md` on `main`
- **Approved:** 2026-09-15, jwloka, in-session
- **Branch:** `bug/the-board-loop-reads-the-same-ceiling` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Single-slice plan. Nothing waits on it and it waits on nothing.

### What to build

The board's auto-dispatch loop decides whether to fork an agent **twelve times a minute** and applies no band-aware bound at all. The fleet supervisor, deciding once every 60 s, applies `ceilingFor(headroom)` — `starved → 1`, `tight → 2`, `clear`/`unmeasured` → `Infinity`. Both callers read the same machine reading; only one acts on it.

Export `ceilingFor` from `packages/domain/src/rules/fleet-size.ts` and bound the auto-dispatch budget by it. Every threshold, every constant and the supervisor's own path stay exactly as they are. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The export is one word, and there is no barrel file to update.** `packages/domain/src/index.ts:58` is `export * from './rules/fleet-size.js'` — a star export. Changing `const ceilingFor` to `export const ceilingFor` at `fleet-size.ts:165` makes it reachable as `import { ceilingFor } from '@plot-pm/domain'` with zero index edits. `auto-dispatch.ts:9-16` already imports five names from that specifier; add a sixth.

**`ceilingFor` is a rule, not a helper being promoted for convenience.** It reads only `headroom` and answers only a ceiling. It was private by history rather than by design — `fleetSize` (`fleet-size.ts:144`) is its only current caller. This gives it a second legitimate one.

**Do not call `fleetSize` instead.** It takes `FleetSizeReadings {requested, running, spawnCostMs, headroom}`. The board holds neither `requested` nor `running` in the shape that rule means — it holds a slot budget already net of `liveCount` and its own in-flight marks. A board calling `fleetSize` would have to invent two of its four inputs.

**Do not add a latch, ratchet or any cross-pass state.** A rejected sibling — `the-tight-band-remembers-what-it-started` — proposed exactly that: a `tight` reading forbidding the next dispatch until `clear`. It was rejected because **`clear` was observed zero times in 102 readings** (lowest 41.0 ms against a 10 ms threshold), so the reset event never fired and the board would have stopped permanently.

**What makes a ceiling safe is that the bounded quantity is a difference, not that the function is pure.** A pure function can still pin a system if it bounds a *level*. The budget here is `parallelAgents - (liveCount + inFlight.size)` — a shortfall that closes itself as agents come up. At a ceiling of 2 per 5-second pulse the ramp is **24 agents/minute**; the fleet reaches `parallelAgents = 3` in two pulses and 6 in three. No plausible cap makes the bound binding.

**`starved` is unreachable from this caller, and the tests must not pretend otherwise.** `machineDefers` (`auto-dispatch.ts:411-419`) returns a deferral when `dispatchDefers(machine)` — i.e. `headroom === 'starved'` (`entities/machine.ts:115`) — and the loop returns at `:476`, **before** the budget is computed at `:478`. So `STARVED_CEILING = 1` is reached only under `controls.machineOverride`. Pin that the board still dispatches zero on a plain `starved` reading, and pin the ceiling's own `starved → 1` answer at the rule level where it *is* reachable.

**THERE ARE TWO BUDGET ASSIGNMENTS, NOT ONE — and the plan's `Done when` names only the first.** `auto-dispatch.ts:478` sets `budget = controls.parallelAgents - (liveCount + inFlight.size)`. When that is `<= 0`, `:492-495` **reassigns** it: `budget = freeAgentCount(agents, pulse)`, the deliberate fall-through that lets the fleet reuse a slot it already holds rather than wait for one to be released. A `min` applied only at `:478` leaves that path unbounded — and it is reached exactly when the fleet is at its cap, which is when a `tight` machine most needs the bound. **Bound both, or state in the PR why the fall-through is deliberately left open.** This was found during hand-off and is not in the plan; if bounding it turns out to change behaviour the plan did not sanction, report it rather than deciding silently.

**Do not raise the ceiling anywhere.** `auto-dispatch.ts:490-493` records why: adding the free-agent count to the budget instead of replacing it would re-invert `bug/a-landed-branch-still-holds-a-slot` (2026-08-25). `min` can only ever lower, which is the whole safety argument — keep it that way.

**Do not touch `HEADROOM_THRESHOLDS`.** `entities/machine.ts:20` is `{clearBelowMs: 10, starvedAboveMs: 50}`, marked provisional and due for re-measurement. That is a separate plan. Tuning it here moves two things at once.

**Carried over unchanged:** `clear` and `unmeasured` both answer `Infinity`, so `min` must be a no-op for both — absent is not starved, and an unmeasured machine is not a vetoing one.

### Done when

The plan's `## Done when` list is the specification. Lifting the assertions that exist **because a naive implementation would pass without them**:

- **`clear` and `unmeasured` produce behaviour byte-identical to today's.** This is the gate proving no healthy machine is slowed. A `min` that silently coerced `Infinity` to a finite cap would pass every band test and fail here.
- **The band numbers are read from `TIGHT_CEILING` and `STARVED_CEILING`, never written literally.** Catches a test that would assert a stale `2` after someone changes the constant.
- **A `starved` reading still permits one dispatch rather than zero** — `fleet-size.ts:78-89` states why: a starved fleet that starts nothing can never recover on its own. Catches an implementation that treats `starved` as a veto.
- **No cross-pass state.** Two identical passes with no dispatch between them must produce identical answers. Catches the rejected sibling's shape reappearing.
- **`HEADROOM_THRESHOLDS` asserted literally as `{clearBelowMs: 10, starvedAboveMs: 50}`.** Catches a drive-by tune.
- **The supervisor's path is untouched**, pinned by `packages/domain/test/fleet-size.test.ts` passing **unmodified**. If you edited that file, the bound moved somewhere it should not have.

Plus the repo gates: `pnpm run test:contracts`, `pnpm run test:board` (rebuilds the artifact), `pnpm run typecheck`, and a changeset. `nvm use` first — pnpm crashes on Node 26. **Do not run `pnpm run test:e2e`**; that is CI's gate, not a local one.

Changeset names `@plot-pm/board` and `plot` as appropriate, description first and any `bumps:` block last. It may carry `plan: docs/plans/2026-09-15-the-board-loop-reads-the-same-ceiling.md`.

### Bookkeeping

Open the PR through the controller — **not `gh pr create`**, which takes its title from the last commit subject:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while work is moving
```

Append `→ #<number>` to this branch's line in the plan's `## Slices` section when the PR exists. Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `packages/domain/src/rules/fleet-size.ts` — the export, and nothing else
- `packages/board/src/server/auto-dispatch.ts` — the budget bound
- tests covering both, plus the rebuilt board artifact and a changeset

It does **not** own `packages/domain/src/entities/machine.ts` (thresholds), `packages/domain/test/fleet-size.test.ts` (must pass unmodified), or `plot-registryd`'s path.

No other branch on this estate currently touches these three files — verified 2026-09-15 against `origin/main` at `e98cba7cd`, with zero commits on any of them since the plan was approved.

If you find something the plan did not anticipate — the fall-through bound above is the likeliest — report it rather than improvising outside scope.

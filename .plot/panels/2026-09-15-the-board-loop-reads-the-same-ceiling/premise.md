# Juror — premise lens

Subject: `docs/plans/2026-09-15-the-board-loop-reads-the-same-ceiling.md` (Draft)
Lens: **premise** — is the thing this plan says is broken actually broken, read on the path rather than its neighbours.
Read at `origin/main` = `fdcfa1fb88e521b8c62b3bbc0826fd972c5021a7`. `packages/board/src/server/auto-dispatch.ts` is byte-identical between local HEAD and `origin/main`, so every line number below is main's.

## 1. The verifiable claims: most are TRUE, two are not

| claim | verified | where |
|---|---|---|
| `ceilingFor` exists in `rules/fleet-size.ts` | **TRUE** | `fleet-size.ts:165` |
| it is NOT exported | **TRUE** | `fleet-size.ts:165` is `const ceilingFor = …`; no `export` and no re-export in `index.ts` (`index.ts:58` is `export * from './rules/fleet-size.js'`, which cannot reach a module-private const) |
| `TIGHT_CEILING = 2` | **TRUE** | `fleet-size.ts:99` |
| `STARVED_CEILING = 1` | **TRUE** | `fleet-size.ts:88` |
| `clear` and `unmeasured` both return `Infinity` | **TRUE** | `fleet-size.ts:166-170` — both fall through to `Number.POSITIVE_INFINITY` |
| `auto-dispatch.ts` imports nothing from `fleet-size.ts` | **TRUE** | the only importer on the estate is `workflows/assign.ts:2`; `grep -rn "fleet-size" packages/` returns exactly two hits, neither in the board |
| the budget line at `auto-dispatch.ts:479` | **FALSE (off by one)** | the line is **`:478`**. `:479` is blank. Cosmetic, and noted only because this is the plan's load-bearing citation |
| supervisor `DESKS_PER_TICK = 3` | **TRUE** | `entry/registryd-main.ts:482` |
| supervisor 60 s tick | **TRUE** | `entry/registryd.ts:52` — `TICK_INTERVAL_MS = 60_000` |
| board 5 s cadence | **TRUE** | `fleet.ts:100` — `REFRESH_MS = 5_000` |
| `HEADROOM_THRESHOLDS = {clearBelowMs: 10, starvedAboveMs: 50}`, marked provisional | **TRUE** | `machine.ts:20`, docstring `machine.ts:18` |
| `fleet-size.ts:78-82` says a starved fleet that starts nothing cannot recover | **TRUE** | the docstring spans `:76-85`; the quoted sentence is at `:80-82` |
| `wanted = requested - running` at `fleet-size.ts:130` | **TRUE** | `fleet-size.ts:130` exactly |

**Could not verify:** nothing in the code. I did not attempt to re-derive the 63/0 log measurement — the panel record already established it and this plan states it correctly.

**Two claims are wrong, and the second is not cosmetic.** See §2.

## 2. The comparison table: one cell is FALSE and it is the cell the argument rests on

### Cell "subtracts running — board: **no**" is FALSE

`auto-dispatch.ts:478`:

```
let budget = controls.parallelAgents - (liveCount + inFlight.size);
```

`liveCount` is `liveAgentCount(agents, pulse)` (`auto-dispatch.ts:981`), which is `auto-dispatch.ts:121-123`:

```
export function liveAgentCount(agents: AgentEntry[], _pulse?: FleetReading): number {
  return agents.filter((a) => LIVE_STATES.has(a.state)).length;
}
```

**That is a count of running agents, subtracted from the cap.** It is the same arithmetic `fleet-size.ts:130` performs (`requested - running`), against the same registry — `registryd-main.ts:510` reads `settings.parallelAgents` from *"the same file the board writes"*, and its own `running` is `readings.agents.length` (`assign.ts:186`).

The board in fact subtracts **more** than the supervisor: `liveCount + inFlight.size`, where `inFlight` is the cross-board shared mark set (`auto-dispatch.ts:992-997`) that the supervisor has no equivalent of. The supervisor counts only `readings.agents.length`.

The plan's own body contradicts its table two paragraphs later — *"subtracts only its own in-flight marks"* — which is also wrong in the other direction, since `liveCount` is not an in-flight mark.

**This matters because the table is the plan's entire case.** Of four rows, one is false, and it is the one asserting the board lacks a bound the supervisor has.

### The other three cells

- cadence 5 s vs 60 s tick — **TRUE**, `fleet.ts:100` and `entry/registryd.ts:52`.
- band ceiling, board **none** — **TRUE in the narrow sense** that no `ceilingFor` is called, but see §3: the board has a *different* band gate the supervisor does not have.
- per-tick rate limit, board **none** — **TRUE** for `DESKS_PER_TICK`; the board's per-pass rate limit is the budget itself.

## 3. THE PREMISE FAILS ON THE LENS QUESTION: the budget is a different noun

**This is my assigned question and it is the finding.** *Does bounding the BUDGET bound dispatches per pass?* It bounds something — but not the quantity the plan's argument imports the supervisor's ceiling to bound, and the ceiling's two constants were sized for the other noun.

### What the budget actually counts

Traced end to end:

1. `auto-dispatch.ts:478` — `budget = parallelAgents - (liveCount + inFlight.size)`.
2. `:492-495` — **if the budget is ≤ 0 it is REPLACED by `freeAgentCount(agents, pulse)`** and the pass continues.
3. `:497-513` — the loop spends budget per plan: `max = Math.min(budget, startable)`, where `startable` counts **branches**.
4. `:920` — one spawn per *plan*: `plot-dispatch.sh --max <max> <slug>`.
5. `:929` — `startableBranches(...).slice(0, plan.max)` — the branches marked in flight.

**So the budget's unit is BRANCHES (slices) named across plans in one pass.** `ceilingFor`'s unit is **AGENTS BROUGHT INTO EXISTENCE**. `assign.ts:141` is unambiguous:

```
for (const desk of (input.fleet?.desks ?? []).slice(0, scaling?.start ?? 0)) {
  writes.push({ kind: 'worker-start', branch: '', worktree: desk });
}
```

`branch: ''` — and the comment at `:142-149` says so explicitly: *"the first thing to apply it starts an agent with NO slice … A start that named a branch would be the assignment happening twice."*

**`ceilingFor` bounds how many new processes fork. The board's budget bounds how many already-paid-for slots get work handed to them.** `min()` over the two is a type error in the domain sense even though both are `number`.

### The fall-through makes it concrete

`auto-dispatch.ts:486-491` is the comment the plan cites in its Notes as *"forbids raising the ceiling"*. Read in full, it says the opposite of what the plan uses it for:

> *"So a spent budget falls through to the free agents rather than refusing: the fleet reuses a slot it already holds instead of waiting for one to be released. `parallelAgents` is still the ceiling — a free agent is an EXISTING slot, never an extra one."*

**The dominant path this plan would bound spawns no new process at all.** When `budget <= 0`, the budget becomes `freeAgentCount` — agents that already exist, are already counted against `parallelAgents`, and are between slices. Applying `ceilingFor('tight') = 2` there **refuses to hand work to an idle agent that is already running and already costing the machine what it costs**, on the grounds that the machine is too loaded to start it. It is already started. Throttling it frees nothing and starts nothing; it only makes a paid-for agent sit idle.

That is not a smaller version of the supervisor's rule. The supervisor never reaches this case, because it has no "hand a slice to an existing free agent" path bounded by `fleetSize` — `matchQueue` does that (`assign.ts:134`) and `scaleUp` is explicitly separate from it.

### `starved` is already handled, so one of the two constants is dead

`auto-dispatch.ts:476` — `if (machineDefers(machine, controls)) return [];` — runs **before** the budget at `:478`. `machineDefers` (`:411-418`) returns non-null exactly when `dispatchDefers(machine)`, which is `machine.ts:114`: `headroom === 'starved'`.

**So the board already returns `[]` on `starved`, without an override.** `ceilingFor('starved') = 1` is therefore unreachable at the proposed call site: by the time `min()` is computed, `headroom` can only be `clear`, `tight`, or `unmeasured`.

The plan's `Done when` requires *"a `starved` reading still permits one dispatch rather than zero, pinned explicitly."* **On today's code a `starved` reading permits ZERO** and has since `machineDefers` was written. A test pinning "starved permits one" either fails, or passes only by calling `planAutoDispatch` with `machineOverride` set, or passes against a `ceilingFor` unit test that proves nothing about the board. A gate that cannot be satisfied on the real path without changing the very behaviour the plan says it does not touch is a gate that will be satisfied by the wrong test.

**The real content of this plan is therefore one number: `TIGHT_CEILING = 2` applied to a branch count.** And `fleet-size.ts:93-98` says what that 2 is: *"Two is the default's request minus the one a starved machine still gets, which is a shape rather than a measurement and is stated as such: nothing here has been measured at the tight edge."* An unmeasured shape, sized for agent starts, transplanted onto slice hand-offs.

### Is the board genuinely unbounded by headroom?

**No.** On the path:

- `starved` → hard refusal, `:476`.
- `clear` / `unmeasured` → `ceilingFor` is `Infinity`; the plan changes nothing by its own admission.
- `tight` → dispatches, bounded by `parallelAgents - (liveCount + inFlight.size)`, which is a real bound that subtracts running agents.

**The honest statement of the gap is: in the `tight` band only, the board's per-pass bound is the operator's cap rather than a band-specific one.** That is narrower than *"no band-aware bound at all"* and much narrower than *"genuinely unbounded"*. The `tight` band dispatching is documented, deliberate behaviour (`machine.ts:106-110`), and the previous panel already established that the estate's observed readings were **all** `tight` — so this plan's one live effect is to cap the tight band at 2 slices per pass, permanently, on this machine.

## 4. The unattributed spawner the plan does not mention

`auto-dispatch.ts:1189-1236` spawns `claude -p` brief writers — one process per plan — under its **own separate budget**:

```
let askBudget = controls.parallelAgents - (liveCount + allInFlight.size + briefsAsked.size);
```

`:1191-1196` states the reason: *"THE BUDGET, BECAUSE A BRIEF WRITER COSTS AN AGENT."*

**This runs BEFORE `planAutoDispatch` (`:1239`) and is untouched by the proposed change.** It is a second per-pass process spawner, on the same 5 s cadence, reading the same machine, deferring on nothing but `machineDefers` above it. A plan claiming to bound the board's loop by headroom that leaves `askBudget` unbounded has bounded one of the two spawners in the file — and the unbounded one is the one that forks `claude -p` directly rather than handing a slice to an existing agent.

The plan's *"It does not unify the callers"* section names three spawners (board, supervisor, operator) and does not name this fourth, which is inside the very function it modifies.

## 5. What `Done when` fails to pin

An implementation can satisfy every stated gate and be wrong, in at least four ways:

1. **Unit-test `ceilingFor` and never test the board path.** Every clause — "`clear` and `unmeasured` byte-identical", "`tight` bounds to 2", "`starved` permits 1", "pure function of one reading" — is satisfiable by tests over `ceilingFor` alone. None requires `planAutoDispatch` to be called. `min(x, Infinity) === x` is trivially true and pins nothing about the board.
2. **The `starved` clause is unsatisfiable on the real path** (§3), so whoever implements it will reach for a synthetic call site — the same failure the sibling was rejected for, where the `Done when` pinned a reset with a `clear` reading the estate never produced.
3. **The free-agent fall-through is not mentioned once.** An implementation applying `min` at `:478` only (before the fall-through) and one applying it after `:495` differ by exactly the case in §3 — whether an idle, already-running agent may be handed work on a tight machine. Both satisfy every clause. They differ by whether the fleet stalls with agents sitting idle.
4. **"Two identical passes with no dispatch between them produce identical answers"** is satisfied by any pure function, including one applied at the wrong site or to the wrong noun. It tests statelessness, which nobody disputes, and not correctness.

Nothing in `Done when` requires a measurement of the resulting behaviour: no assertion that the tight band still makes progress, no number for how many slices per minute a tight machine may hand over, no check that an idle agent is not starved of work.

## 6. The strongest argument against doing this at all

**It imports a constant the domain explicitly labels unmeasured, applies it to a different quantity than it was sized for, and on this estate's own readings that is the only effect it has.**

`fleet-size.ts:93-98` says `TIGHT_CEILING = 2` is *"a shape rather than a measurement … nothing here has been measured at the tight edge."* The previous panel established that every reading on this estate was `tight` (41.0–50.0 ms, zero `clear` in 102 samples). So:

- `clear` never occurs → the `Infinity` path is dead here.
- `starved` already returns `[]` at `:476` → that ceiling is unreachable.
- **Every pass on this machine takes the `tight` arm**, and the change is: hand over at most 2 slices per pass, forever.

That is a permanent, unmeasured throttle chosen for a different noun, on a board that already subtracts running agents and already refuses when starved. The previous plan was rejected for shipping a latch whose reset was never observed; this ships a ceiling whose only live branch is the one the domain says was never measured — and it would sit in front of the free-agent fall-through, where it can only make an already-running agent idle.

**The panel's recommendation said "the fix is the ceiling the supervisor already has, applied to the caller that lacks it."** That recommendation was made by a juror who did not trace what the board's budget counts. It is the right instinct about *which caller* and the wrong conclusion about *what to apply*, because the two callers bound different nouns.

## 7. What is true and worth keeping

- The board and the supervisor genuinely do read one machine independently and coordinate nothing. That is the finding the previous panel called *"the more interesting one"*, and it survives.
- `ceilingFor` being module-private while a second caller wants the same judgement is a real seam.
- The plan is honest about the predecessor's failure: it states the 63/0 measurement correctly, disclaims the process attribution, and does not repeat the false premise. **The premise that was rejected is not repeated.** A different, smaller one has replaced it.

## What I would need to support this

1. Correct the table: the board **does** subtract running agents (`:478`, `liveAgentCount`).
2. State what the budget counts (slices handed over) versus what `ceilingFor` counts (agents started), and argue explicitly that one number may bound the other — or pick a different bound.
3. Decide the free-agent fall-through (`:492-495`) in the plan text, not in the implementation.
4. Drop the `starved` clause or state that it is unreachable at the call site and why the gate is still worth having.
5. Name `askBudget` (`:1197`) as in or out of scope.
6. Either re-measure `TIGHT_CEILING` against slice hand-offs, or say plainly that an unmeasured shape is being adopted and why that is acceptable here.

None of these is fatal. The plan names a real seam and a real asymmetry, and it is a marked improvement on its predecessor. But its central table cell is false, its one live code path is not the one it argues about, and one of its gates cannot be met on the path it claims to change.

Verdict: amend

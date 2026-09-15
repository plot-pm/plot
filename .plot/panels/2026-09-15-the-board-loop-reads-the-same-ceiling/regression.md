# Juror — regression lens

Subject: `docs/plans/2026-09-15-the-board-loop-reads-the-same-ceiling.md` (Draft)
Lens: **regression** — what breaks for someone whose machine is fine.
Read against `origin/main` at `fdcfa1fb8`.

## 1. The factual claims

**Verified true, every one I could reach:**

| claim | where | result |
|---|---|---|
| `ceilingFor` is unexported | `packages/domain/src/rules/fleet-size.ts:165` | **TRUE** — `const ceilingFor = (headroom: Headroom): number =>`, no `export` |
| `TIGHT_CEILING = 2` | `fleet-size.ts:99` | **TRUE** |
| `STARVED_CEILING = 1` | `fleet-size.ts:88` | **TRUE** |
| `clear`/`unmeasured` → `Infinity` | `fleet-size.ts:168-170` | **TRUE** — one shared `return Number.POSITIVE_INFINITY` under the comment naming both |
| `auto-dispatch.ts` imports nothing from `fleet-size.ts` | `auto-dispatch.ts:1-21` | **TRUE** — it imports `@plot-pm/domain` (line 9-16) and `@plot-pm/domain/adapters`, but `git grep -l fleet-size -- packages/` names only `domain/src/index.ts` and `domain/src/workflows/assign.ts` |
| supervisor subtracts running | `fleet-size.ts:130` | **TRUE** — `const wanted = Math.max(0, requested - running)` |
| `HEADROOM_THRESHOLDS = {clearBelowMs:10, starvedAboveMs:50}`, marked provisional | `entities/machine.ts:20`, `:18` | **TRUE**, both |
| board's own comment forbids raising the ceiling | `auto-dispatch.ts:488-491` | **TRUE** in substance; the plan cites `:490-493`, off by two |

**One citation is wrong.** The plan names the budget line at **`auto-dispatch.ts:479`**; it is at **`:478`** (`:479` is blank). Trivial, but this estate has a documented habit of stated figures that do not re-derive — the predecessor panel logged *"third document this week"* — so it is named rather than waved through.

**One thing I could not verify:** the plan's `Rounds`/provenance claim that the `callers` lens "produced this plan's whole argument" is accurate against `panel.md`, but the panel's recommendation was *two findings, each its own plan*. This plan takes finding 1. Finding 2 (three spawners, no shared in-flight window or machine reading) is correctly scoped out and named. No objection.

## 2. The comparison table — one cell is FALSE

| cell | plan says | measured |
|---|---|---|
| cadence 5 s vs 60 s | — | not re-derived here; consistent with `:1129` *"affordable against the 5 s cadence"* |
| band ceiling: board **none** | — | **TRUE** for the tight band |
| **subtracts running: board `no`** | **no** | **FALSE** |
| per-tick rate limit | none vs `DESKS_PER_TICK = 3` | plausible, not re-derived |

**`auto-dispatch.ts:478` is `controls.parallelAgents - (liveCount + inFlight.size)`.** `liveCount` is `liveAgentCount(agents, pulse)` (`:981`) and `agents` comes from the **shared** registry — `:951-952`, *"`entry.agents` comes from the SHARED agent registry, so `parallelAgents − live` is the same number whoever asks."*

That is precisely `requested - running`. The board subtracts running agents **and** in-flight marks, which is strictly more than the supervisor subtracts. The table's own framing — *"the supervisor asks how big the fleet should be and subtracts reality; the board … subtracts only its own in-flight marks"* — is wrong twice: the board subtracts live agents too, and those marks are not "its own" since `:953-956` made the in-flight half shared across boards.

This matters beyond pedantry: the table is the plan's argument that the two callers are asymmetric. On the row that would most justify the change, they are **symmetric already**, and the real asymmetry is the single row *band ceiling: none*. The plan's own prose says *"that asymmetry is the defect, and it is the whole defect"* — correct, but it is one row, not three.

## 3. THE KEY QUESTION: a permanently-tight board with a ceiling of 2

**The estate's readings, re-derived from `.plot/logs/board.log` rather than taken from the plan:**

```
all spawn-cost readings      : 102
clear   (<10 ms)             :   0
tight   (10–50 ms)           :  63     range 41.0 – 50.0 ms
starved (>50 ms)             :  39     up to 1358.0 ms
```

Confirmed: `clear` **zero times in 102**, lowest reading **41.0 ms**, and all 63 tight readings sit in the top fifth of the tight band. The board here is `tight` or worse, always.

**Now compute what the ceiling does. This is the question I was asked, and the answer acquits the plan.**

The ceiling bounds `budget`, and `budget` is **already a shortfall**: `parallelAgents - (liveCount + inFlight.size)`. So each pulse re-reads how many agents are actually up and asks only for the difference. Simulating a permanently-tight board at the default `parallelAgents = 3` (`fleet-settings.ts:71`):

```
pulse  1 (t= 0s)  live=0  budget=3  ceiling=2  started=2  live=2
pulse  2 (t= 5s)  live=2  budget=1  ceiling=2  started=1  live=3  -> at cap
```

**The fleet reaches its full cap in two pulses — ten seconds.** At `parallelAgents = 6` it takes three pulses, fifteen seconds. A ceiling of 2 on a 5-second cadence is a **ramp rate of 24 agents/minute**, which no plausible `parallelAgents` makes binding.

**So the plan's claim survives the data, and it survives it for a reason the plan does not state.** "It is a pure function of one reading" is true but insufficient — a pure function can still pin a system if the quantity it bounds is absolute. What actually saves it is that **the bounded quantity is a difference, not a level**. The rejected sibling's ratchet gated on a *reset event* that never occurred; this gates on a *shortfall* that shrinks to zero on its own as agents come up. There is no reset condition to fail to fire. **On this estate, a permanently-tight board with a ceiling of 2 behaves differently from the latch in exactly the way that matters: the latch pinned at STOPPED, this converges to the cap in ≤3 pulses.** Verdict on the panel's key question: the "cannot latch" claim is **correct**, and the measured data is what proves it rather than merely failing to refute it.

**What a healthy board loses: nothing.** `clear` and `unmeasured` both answer `Infinity`, so `min` is an identity. Byte-identical, and the plan pins it.

**What a busy board loses: a ramp, bounded at ten to fifteen seconds.** Acceptable.

## 4. What `Done when` fails to pin — two real gaps

### 4a. The `starved` gate is UNSATISFIABLE from the board loop

`Done when` requires: *"a `starved` reading still permits one dispatch rather than zero, pinned explicitly."*

**The board already returns `[]` on `starved`, before the budget line ever runs:**

```
auto-dispatch.ts:476   if (machineDefers(machine, controls)) return [];
auto-dispatch.ts:478   let budget = controls.parallelAgents - (liveCount + inFlight.size);
```

`machineDefers` (`:411-419`) returns a sentence when `dispatchDefers(machine)` — and `dispatchDefers` is `machine.headroom === 'starved'` (`machine.ts:115`). So on a starved reading the board dispatches **zero**, today, at `:476`. `STARVED_CEILING = 1` is **unreachable** from this caller — unless `controls.machineOverride` is set (`:416`), which is the operator saying *now anyway*.

**The plan never mentions `machineDefers`.** It presents the board as having "no band-aware bound at all" when the board in fact has the *harder* bound on the starved band — a full stop where the supervisor permits one. An implementer satisfying this gate literally would either (a) write a domain-level unit test on `ceilingFor('starved') === 1`, which passes while proving nothing about the board, or (b) reorder `:476` below the budget so the ceiling's starved arm becomes live — **which would loosen a refusal into a permission, turning a stop into one-per-pulse = 12 dispatches/minute on a starved machine.** That is a regression the `Done when` invites rather than forbids, and it is the one this lens exists to catch.

The gate should read: *the `starved` path is untouched — `machineDefers` still returns `[]` at `:476` and the ceiling's starved arm is unreachable except under `machineOverride`.*

### 4b. The free-agent fall-through is throttled, and it should not be

`:492-495`:

```
if (budget <= 0) {
  budget = freeAgentCount(agents, pulse);
  if (budget <= 0) return [];
}
```

Below this line `budget` is **no longer a shortfall** — it is an absolute count of agents that are *already running and already paid for*. `:488-490`: *"a free agent is an EXISTING slot, never an extra one."* Handing a slice to a free agent **forks nothing new**; the machine cost is already borne.

Writing the bound as `min(budget, ceilingFor(headroom))` after this block throttles that reuse: at cap with 5 free agents on a tight machine, `min(5, 2) = 2`. Three agents that could take work now sit idle, and the machine gains nothing, because no fork was going to happen. **On this estate — permanently tight — that throttle is permanent.** It does not latch the fleet at zero, but it does permanently halve the rate at which landed-branch agents pick up their next slice, and this estate is exactly the one where `a-landed-branch-still-holds-a-slot` (2026-08-25) was measured.

The `Done when` specifies the formula as `min(parallelAgents - (liveCount + inFlight.size), ceilingFor(headroom))` — which reads as the pre-fall-through budget and is right. But the natural implementation puts one `Math.min` at the end of the block, and every stated gate still passes. **An implementation can satisfy every gate and still be wrong**, which is question 4 answered concretely.

Fix: bound the fork-budget only, leaving the reuse path unbounded —

```
let budget = Math.min(controls.parallelAgents - (liveCount + inFlight.size), ceilingFor(headroom));
if (budget <= 0) { budget = freeAgentCount(agents, pulse); if (budget <= 0) return []; }
```

### 4c. Minor: `headroom` is not an input to `planAutoDispatch`

`PlanAutoDispatchInput` carries `machine?: MachineEntity` (`:456`), not a `Headroom`. The implementer must call `ceilingFor(machine?.headroom ?? 'unmeasured')`. The `?? 'unmeasured'` matters: an **absent** machine must answer `Infinity`, matching `:400-402` *"ABSENT DISPATCHES."* Getting this wrong — e.g. `ceilingFor(machine.headroom)` on a machine that is `undefined` — throws inside a pure planner on every pulse where sampling failed. **On sampling failure the behaviour must be today's**, and the `Done when` pins `unmeasured` but not *absent*, which is a different input reaching the same arm.

**`unmeasured` behaves as the plan claims** — `fleet-size.ts:168-170` returns `Infinity` for it explicitly, and `machineDefers` returns `null` for an absent machine at `:415`. Both verified.

## 5. The strongest argument AGAINST doing this at all

**The tight band has no measured content, and this change is the first thing to act on it.**

`TIGHT_CEILING = 2`'s own docstring (`fleet-size.ts:93-98`) says it plainly: *"Two is the default's request minus the one a starved machine still gets, which is **a shape rather than a measurement** and is stated as such: nothing here has been measured at the tight edge, and a number that pretended otherwise would be a claim."*

And `HEADROOM_THRESHOLDS` is *"Provisional: they come from one session's samples and are to be re-measured"* (`machine.ts:18`).

So the change propagates an **admittedly unmeasured constant**, through an **admittedly provisional threshold**, into the caller that runs **twelve times a minute** — on an estate where that threshold classifies **100% of readings as tight-or-worse** and `clear` has never once been observed. The thresholds are not describing this machine: a band whose clear arm never fires in 102 samples is a band that is mis-calibrated, not a machine that ispermanently busy. Acting on the classification before fixing the classification is building on the thing the code says is provisional.

The plan anticipates this and answers *"re-measuring is a separate plan, and tuning them inside this one would move two things at once."* That is sound sequencing discipline. But it argues for ordering, not for doing this first — and the counter-argument is that the *right* order is re-measure, then bound, because a ceiling applied through a broken classifier is a ceiling applied to the wrong band.

**Why I do not think this sinks the plan:** the computation in §3 shows the tight ceiling is non-binding within 2–3 pulses whatever the calibration. A mis-calibrated `tight` costs ten seconds of ramp, not a stalled fleet. The blast radius of being wrong about the band is small **precisely because** the bounded quantity is a shortfall. If the ceiling bounded a level, this argument would be fatal.

## Summary

The plan is directionally right, its mechanism genuinely cannot latch, and its healthy-board claim is exact — `clear`/`unmeasured` → `Infinity` → `min` is an identity. It correctly diagnoses the one asymmetry that is real. It does **not** warrant rejection.

It needs three amendments before implementation:

1. **Correct the table.** The board *does* subtract running agents (`:478`, shared registry). One row of the three is the actual defect.
2. **Name `machineDefers` and fix the `starved` gate.** The gate as written is unsatisfiable from the board and invites an implementer to loosen a refusal. Replace with *the starved path is untouched*.
3. **Bound the fork-budget, not the free-agent reuse.** Specify the `min` placement above the `budget <= 0` fall-through, and pin it: *a board at cap with N free agents dispatches N on a tight machine, not `min(N,2)`.*

Plus: fix `:479` → `:478`, and pin *absent machine* alongside *unmeasured*.

Verdict: amend

# Juror — layering

Subject: `docs/plans/2026-09-15-the-board-loop-reads-the-same-ceiling.md` (Draft)
Lens: **layering** — controller → domain → port ← adapter → script; the domain owns
its ports; no domain-specific code outside the domain; readings as values.

## 1. Every factual claim I was asked to verify is TRUE

Verified against `origin/main` at `fdcfa1fb8`.

| claim | verified | evidence |
|---|---|---|
| `ceilingFor` is unexported | **true** | `packages/domain/src/rules/fleet-size.ts:165` — `const ceilingFor = (headroom: Headroom): number =>`; `grep -n "export const ceilingFor"` returns nothing |
| `TIGHT_CEILING = 2` | **true** | `fleet-size.ts:99` |
| `STARVED_CEILING = 1` | **true** | `fleet-size.ts:88` |
| `clear`/`unmeasured` → `Infinity` | **true** | `fleet-size.ts:166-170`, `return Number.POSITIVE_INFINITY` after both band checks fall through |
| `auto-dispatch.ts` imports nothing from `fleet-size.ts` | **true** | its only domain imports are `isAnswered, isFree, dispatchDefers, deferralMessage, hasRoomToDispatch, Machine` (`auto-dispatch.ts:9-16`) and `refsGit, shellContext` from `/adapters` (`:8`). `grep -n "fleetSize\|ceilingFor\|DEFAULT_FLEET_SIZE"` over the file returns nothing |
| budget line at `auto-dispatch.ts:479` | **off by one, immaterial** | the line is **478**: `let budget = controls.parallelAgents - (liveCount + inFlight.size);`. A second, duplicate budget line sits at **:1070** — see §4.2, the plan does not mention it |
| `ceilingFor` at `:163-171` | **true within one line** | the arrow is at `:165`, the TSDoc opens at `:158`; body `:165-171` |
| `fleet-size.ts:78-82` "starved that starts nothing cannot recover" | **true** | the sentence is at `:78-82` |
| `HEADROOM_THRESHOLDS` provisional, `machine.ts:18-19` | **true** | `machine.ts:20` holds `{ clearBelowMs: 10, starvedAboveMs: 50 }`; the *Provisional* sentence is `:17-18` |
| `auto-dispatch.ts:490-493` forbids raising the ceiling | **true** | `:488-491` — *"`parallelAgents` is still the ceiling … Adding them would raise the cap and re-invert `bug/a-landed-branch-still-holds-a-slot` (2026-08-25)"* |

**Could not verify:** nothing in the rubric list. I did not re-derive the 63/0 log
measurement — it is the predecessor panel's finding and this plan restates it
correctly as *unattributed*.

## 2. The comparison table is accurate — all eight cells

| cell | verified |
|---|---|
| supervisor tick 60 s | `entry/registryd.ts:52` — `export const TICK_INTERVAL_MS = 60_000` |
| supervisor band ceiling `TIGHT=2`/`STARVED=1` | `fleet-size.ts:88,99`, reached via `:144` |
| supervisor subtracts running | `fleet-size.ts:133` — `const wanted = Math.max(0, requested - running)` |
| `DESKS_PER_TICK = 3` | `entry/registryd-main.ts:482` |
| board band ceiling: none | confirmed — no `fleet-size` symbol reaches the file |
| board subtracts running: no | it subtracts `liveCount + inFlight.size`, its own in-flight marks, which is what the plan says |
| board cadence 5 s | I did **not** find a `5_000` literal in `server/index.ts`; the cadence is the scan's, inherited via `refresh`. Carried from the predecessor panel, which the moderator verified. Not independently re-derived here |

## 3. THE LENS: the export is the right shape, and `fleetSize` is the wrong entrance

**My verdict on the shape is that the plan is right, for a reason it does not state.**

### 3.1 The board must not call `fleetSize`

The obvious layering objection — *the board should call the rule's single
entrance rather than promoting a private helper* — **fails on the readings**.
`fleetSize` takes `FleetSizeReadings {requested, running, spawnCostMs, headroom}`
(`fleet-size.ts:19-59`) and answers `{start, requested, running, headroom,
shortfall}`. Three of those four inputs are quantities the board **does not
have in the shape the rule means**:

- `requested` is an operator's `start N` — the board has `controls.parallelAgents`,
  a **cap**, not a request.
- `running` is workers on the machine — the board has `liveCount + inFlight.size`,
  a **slot count including its own unconfirmed marks**, which is a different
  quantity by construction (`auto-dispatch.ts:305-316`).
- `shortfall` is a sentence for an operator who will **run the command again**
  (`fleet-size.ts:70-74`, *"the shortfall is reported and never remembered"*).
  The board's loop has no operator and runs again in five seconds regardless.

So a board calling `fleetSize` would have to **lie about two of its inputs** to
get one number out, and discard the answer's principal field. That is worse
layering, not better: it makes two different quantities share one parameter name,
which is the exact failure `DEFAULT_FLEET_SIZE`'s own TSDoc warns about
(`fleet-size.ts:11-13` — *"It is not `--max`, and the two are different quantities
that a shared name would merge"*).

### 3.2 `ceilingFor` is a rule in its own right, not a private helper

`ceilingFor` is **a pure total function of one enum**, with no reference to
`requested`, `running`, `spawnCostMs` or any shortfall. It is private by history
rather than by design — it was extracted out of `fleetSize`'s body and never
needed a second caller. Promoting it names the thing that was already there.

**The decisive precedent is in the same estate and the board already uses it.**
`hasRoomToDispatch` and `dispatchDefers` (`entities/machine.ts:102,115`) are
*exactly* this shape: one-line total functions of `machine.headroom`, exported
from the domain, and consumed by `auto-dispatch.ts:388,1058`. `ceilingFor`
answers the third question in that same family — *how many*, beside *is it clear*
and *should it wait*. The board importing it is the **established** pattern here,
not a new one.

### 3.3 Two entrances that can drift? No — one rule, two questions

The drift risk is real in principle and absent here. After the export,
`fleetSize` still calls `ceilingFor` at `:144`; there is no second copy of
`TIGHT_CEILING`/`STARVED_CEILING` and the plan explicitly forbids writing the
numbers literally in the test. **A change to either constant moves both callers
in one edit.** That is one rule with two readers — which is `hasRoomToDispatch`'s
situation already — and not two entrances.

`fleetSize` remains the single entrance to *"how many agents does a **start**
bring up"*. It was never the entrance to *"what does this headroom permit"*.

### 3.4 Where the tests belong — the plan gets this WRONG

The `Done when` says *"pinned by a test"* without naming a package, and names
`pnpm run test:contracts` and *"the board suite"* — **neither of which is the
domain suite**. The correct split, which the plan does not state:

- `ceilingFor`'s **own** band answers (`tight`→2, `starved`→1, `clear`/`unmeasured`
  →`Infinity`) belong in `packages/domain/test/fleet-size.test.ts`, which today
  reaches them only **indirectly** through `fleetSize` (`:98,105,133,151`). There
  is no direct `ceilingFor` test and the export creates the obligation for one.
- the **`min` composition** and the `clear`-is-byte-identical gate belong in
  `packages/board/test/unit/auto-dispatch.test.ts`, beside `planAutoDispatch`.
- `HEADROOM_THRESHOLDS is unchanged, asserted literally` is a **domain** assertion
  and asserting it in the board suite would put a domain constant's contract in
  the wrong package.

A conforming implementation could satisfy every stated gate by putting all of it
in the board suite, leaving a newly-public domain export with no direct test in
its own package. **That is the layering defect the `Done when` permits.**

## 4. What `Done when` fails to pin — three ways to satisfy it and be wrong

### 4.1 `starved` is UNREACHABLE at the budget, so its gate tests nothing real

**This is my strongest finding and the plan appears unaware of it.**

`planAutoDispatch` returns `[]` on a starved reading at **`auto-dispatch.ts:476`**
— `if (machineDefers(machine, controls)) return [];` — **two lines above** the
budget the plan proposes to bound. `machineDefers` is true exactly when
`dispatchDefers(machine)`, i.e. `headroom === 'starved'` (`machine.ts:115`),
unless `controls.machineOverride` is set (`auto-dispatch.ts:415`).

So on the default configuration the board **already starts zero on `starved`**,
and `min(budget, STARVED_CEILING=1)` can never be evaluated. The plan's gate —
*"a `starved` reading still permits one dispatch rather than zero, pinned
explicitly"* — is satisfiable **only** by a unit test that sets
`machineOverride: true`, which the plan never mentions.

Worse, it states a **contradiction** the plan does not resolve:

- `fleet-size.ts:78-82` says a starved fleet that starts nothing cannot recover.
- `auto-dispatch.ts:470-476` says starved defers outright, and there is a live
  `TODO(decision)` at `:474-475` asking whether starved should also stop the
  free-agent fall-through.

The plan quotes the first as its justification and does not notice the board
already implements the opposite. An implementer reading the `Done when`
literally could **delete or weaken the `:476` deferral** to make the gate pass —
changing an existing, deliberate refusal under cover of a plan that says *"it
only ever lowers"*. That is a real path from these gates to a regression.

### 4.2 The `min` is written against the WRONG line — the free-agent fall-through

The plan's formula is
`min(parallelAgents - (liveCount + inFlight.size), ceilingFor(headroom))`.

But `:492-495` **reassigns** budget after that subtraction:

```
if (budget <= 0) {
  budget = freeAgentCount(agents, pulse);
  if (budget <= 0) return [];
}
```

An implementation that applies `min` at `:478` — literally what the plan writes —
leaves the reassigned free-agent budget **completely unbounded by the ceiling**,
which is the path that actually starts workers when the cap is already spent.
The plan would ship a ceiling that does not bind in the case it most matters.
The `Done when` cannot distinguish the two placements: a test with free agents
absent passes either way.

**The `min` must go after `:495`, not at `:478`** — and the plan says the opposite.

### 4.3 The duplicated budget at `:1070` goes unmentioned

`auto-dispatch.ts:1070` recomputes `controls.parallelAgents - (liveCount +
allInFlight.size)` to decide **what to log**, with a comment at `:1071-1074`
demanding the two *"must not diverge"*: *"If this refused where the planner
dispatches, the board would print 'refusing' on the pulse it started a worker."*
Bounding only `:478` makes them diverge in the other direction — the planner
refuses (ceiling) where the logger reports room. Nothing in `Done when` catches
this; the log is not asserted.

### 4.4 The deeper layering finding, which is NOT this plan's to fix

`planAutoDispatch` is a **pure synchronous function taking readings as values**
(`PlanAutoDispatchInput`, `:279-330`, whose own TSDoc at `:286-288` says *"A
READING, not a port — the caller measures and passes the value, so this function
stays pure and synchronous"*). That is verbatim the domain's declared shape
(CLAUDE.md, *"the domain here takes readings as values, not ports"*). It decides
fleet-sizing policy and it lives in `packages/board/src/server/`.

**So this plan imports a domain rule into a file that is arguably domain code in
the wrong package.** I do not hold that against the plan — moving
`planAutoDispatch` is a much larger change with its own blast radius, and this
plan's own *"It does not unify the callers"* correctly scopes it out. But it is
worth recording: the export is right, and the file it is imported into is where
the estate's next layering plan should look.

## 5. Is the problem real, and is exporting `ceilingFor` the right response?

**The problem is real.** The asymmetry in §2 is verified in full: one spawner
consults the band and the other, running twelve times more often, does not.

**The response is right in kind and wrong in placement.** Exporting `ceilingFor`
is the correct mechanism (§3), and the plan is notably disciplined — no state, no
threshold change, `min` cannot raise, supersession honestly declared, and the
predecessor's false premise explicitly disowned rather than inherited. Against
five false-premise plans this week, this one's premises **all hold**.

What it gets wrong is mechanical and fixable in the plan text: the wrong
insertion point (§4.2), a gate whose subject is unreachable (§4.1), an
unmentioned second call site (§4.3), and no package named for its tests (§3.4).

## 6. The strongest argument AGAINST doing this at all

**The bound it adds is nearly always inert, and the one band where it bites is
the band whose threshold is admitted to be unmeasured.**

- `clear` and `unmeasured` → `Infinity`: changes nothing, by the plan's own gate.
- `starved` → already returns `[]` two lines earlier (§4.1): changes nothing.
- **`tight` → 2 is the entire behavioural delta.**

And `tight` is defined by `HEADROOM_THRESHOLDS`, marked *"Provisional: they come
from one session's samples and are to be re-measured"* (`machine.ts:17-18`) and
never re-measured. The predecessor panel's own data says **`clear` was observed
zero times in 102 readings, lowest 41.0 ms** — meaning on this estate the machine
reads `tight` essentially always. So the real shipped effect is **"cap the board
at 2 dispatches per pass, permanently"**, arrived at through a constant whose
TSDoc says it *"is a shape rather than a measurement"* (`fleet-size.ts:95-98`).

That is not the ratchet's failure — it is recoverable, stateless, and `2 > 0` —
but it is a de-facto concurrency cap of 2 reached by inference rather than by
decision. The predecessor panel's closing line applies unchanged: *"A plan that
tunes behaviour around them should re-measure first."*

This argument does not defeat the plan — an inert-or-mild bound is still strictly
better than an unbounded twelve-per-minute loop — but the plan should **say** that
`tight` is the estate's normal reading and that the practical effect is a cap of
2, rather than presenting `clear`-is-unchanged as evidence that healthy machines
are unaffected. On this estate there are no `clear` readings to be unaffected.

## Amendments required

1. **Move the `min` after the free-agent fall-through** (`auto-dispatch.ts:495`),
   not at `:478`. State the placement in `Done when`, and add a gate: *a pass
   whose cap budget is spent and which falls through to free agents is also
   bounded by the ceiling.*
2. **Resolve `starved`.** Either drop the `starved → 1` gate as unreachable and
   say `:476` already answers it, or state explicitly that the gate is tested
   under `machineOverride: true` and that **`:476` is not to be touched.**
3. **Name the test packages** (§3.4): `ceilingFor`'s band answers in
   `packages/domain/test/fleet-size.test.ts`, the `min` composition in
   `packages/board/test/unit/auto-dispatch.test.ts`, `HEADROOM_THRESHOLDS` in the
   domain suite.
4. **Address `:1070`**, or state that the logging budget deliberately stays
   unbounded and why that does not violate its own *"must not diverge"* comment.
5. **State the practical effect**: on an estate with zero `clear` readings,
   `tight` is normal and this ships a cap of 2.

The shape is right. The placement is wrong and one gate is unreachable, and both
are plan-text fixes rather than reasons to abandon it.

Verdict: amend

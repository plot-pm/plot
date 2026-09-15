# Juror: the CALLERS lens

Reading position: how many places decide to spawn, what each reads first, what they share, and whether a ratchet in one survives the others.

## 1. Every factual claim, verified on main (a9601d4f6)

**The three bands and the thresholds — TRUE.** `packages/domain/src/entities/machine.ts:12` declares `['clear','tight','starved','unmeasured']`; `:20` declares `HEADROOM_THRESHOLDS = { clearBelowMs: 10, starvedAboveMs: 50 }`. `headroomFor` (`:54-59`) reads `< 10 → clear`, `> 50 → starved`, else `tight`. The plan's `machine.ts:57-58` citation is one line off (the enum is `:12`, the derivation `:54-59`), which is a citation slip and not a false claim.

**The `Machine` interface's fields — TRUE and the plan's list is exact.** `machine.ts:30-42` carries `spawnCostMs`, `headroom`, `measuredAt`, `sampleMs`, `loadAverage`, `cores`. **Nothing about what is already running.** The plan names four of the six and omits `loadAverage`/`cores`; both are documented `context only, never the verdict` (`:38`, `:40`), so the omission does not weaken the claim.

**The `dispatchDefers` docstring — TRUE, quoted verbatim.** `machine.ts:103-108`: *"That function answers *is the machine clear?*, which `tight` fails; this answers *should a dispatch wait?*, which only `starved` passes."* The plan cites `:106-110`; the sentence spans `:105-107`. Off by a line or two, correct in substance.

**The `dispatching anyway` docstring — TRUE, quoted verbatim.** `auto-dispatch.ts:1054-1057`: *"a fleet that feels slow while nothing refuses is the case an operator otherwise has no reading for."* The plan cites `:1055-1058`.

**The entity's own docstring, "the only state that decays instantly" — TRUE.** `machine.ts:26`.

**`controls.parallelAgents` checked at `auto-dispatch.ts:1069` — TRUE.** `:1069` is `const budget = controls.parallelAgents - (liveCount + allInFlight.size);`. Exact line hit.

**"Two agents produce twelve processes" — TRUE, and I measured it live rather than trusting it.** Two working desks on this machine right now (`free-d10aa93e`, `free-06fff086`). `ps -eo args | grep -c plot-worker-loop` = **12**. The per-desk shape from `ps -eo pid,ppid`: a `sh -c` wrapper → `plot-agent-monitor.sh` + `plot-worker-loop.sh` → two loop children → `claude -p`, plus `sleep`s and a `node`/`npm` test tree. Walking the clean tree (root 32173) gives **20** processes for ONE agent, so if anything the plan's twelve **understates** the multiplier. The claim is conservative, which is the safe direction for the argument it supports.

**Could not verify:** the incident's own 84 processes and ~24 GB — that moment is past and the log does not record a process count. The `/api/board` at 10.7 s likewise is not in the log I read. These are operator observations and I take them as reported; nothing in my lens turns on them.

## 2. The log measurement, re-derived independently

From `.plot/logs/board.log` (176 lines, 16745 bytes, mtime Sep 15 15:02):

```
dispatching anyway : 63      not yet : 39
machine reads tight : 63     (no other headroom word appears)
tight spawn costs  : n=63  min=41.0  median=46.6  max=50.0
                     count >= 40 : 63      count > 50 : 0
starved costs      : 50.6, 51.2, 51.4, ...
```

**63 and 39 confirmed. Min 41.0 confirmed. Max 50.0 confirmed. "Every one at or above 40" confirmed (63/63). "Not one above the 50 ms line" confirmed (0/63).**

**One error: the plan says median 46.4; it is 46.6.** Cosmetic, changes no argument, and should be corrected because this estate's whole error class is numbers nobody re-derived.

The starved side is a clean complement — the lowest `not yet` is 50.6, immediately above the 50.0 ceiling of the tight set. The machine sat in a band 41–51 ms wide for the entire incident. **Nothing crossed into `clear`.** That is the plan's load-bearing observation and it holds.

## 3. Is the diagnosis right?

**Yes.** `dispatchDefers` returned false on all 63 because `tight ≠ starved`, exactly as `machine.ts:103-108` specifies. No predicate misfired. The reading is per-pass and stateless, and `Machine` structurally cannot express *what I already started* — so a board parked at 46 ms dispatches every pass forever. The plan correctly refuses to move a threshold and correctly identifies the missing quantity as memory across passes rather than a wrong number.

And the plan's self-correction is real, not decoration: an earlier draft blamed the gate and the current text disproves it against the code. That is the discipline the four rejected plans lacked.

## 4. What `Done when` fails to pin — FROM MY LENS

**An implementation can satisfy every stated gate and still be wrong, and here is how.** The gates pin: three tights → one dispatch; clear-between → second dispatch; clear-throughout byte-identical; `starved` unchanged; `HEADROOM_THRESHOLDS` literal; the tight line still printed; suites green.

**Nothing pins where the bit lives, and that is the whole risk for the callers question.** An implementation that puts the ratchet in a module-level variable inside the board process passes every gate above. It also fails exactly the way the in-flight set failed before `in-flight-store.ts` existed — `in-flight-store.ts:5-13` records that verbatim: *"that set lived in one process's memory, so a SECOND board on the same repository saw an empty fleet and spent the whole budget again. Two boards seconds apart reached `2 × parallelAgents`."* The estate has already paid for this lesson once, in this exact subsystem, and the plan does not name it.

**Second unpinned thing: what resets the bit besides `clear`.** `unmeasured` is a fourth headroom value the plan never mentions. `hasRoomToDispatch` answers false for it (`machine.ts:98`), `dispatchDefers` answers false (`:110`), and `fleetSize`'s `ceilingFor` treats it as clear (`fleet-size.ts:168-170`). So a ratchet keyed on "not clear" latches permanently on a machine whose sampling fails, while one keyed on "clear resets" never releases. Neither is pinned by the `Done when`, both pass every listed gate, and they differ by *a fleet that never starts again*. The plan's own `clear` resets it sentence (line 87) is one reading of a three-way choice.

**Third: the bit's lifetime across a board restart.** `pnpm board` runs under `node --watch` (CLAUDE.md), so a rebuild restarts the process. If the bit is in memory, every rebuild clears the ratchet. During active development that is several times an hour.

## 5. THE CALLERS MAP — my lens proper

I found **three** spawners, and the plan names all three. What it does not establish is what they share.

| caller | reads the machine? | reads `parallelAgents`? | reads the in-flight store? | reads the registry? |
|---|---|---|---|---|
| **board auto-dispatch** (`auto-dispatch.ts:1041-1063`) | yes — `machineDefers`/`machineIsClear` | yes (`:1069`) | **yes** (`:992`, `readInFlight`) | yes (`liveAgentCount`) |
| **`plot-registryd --start-agents`** (`registryd-main.ts:789,794`) | yes — `fleetCapForRepo` samples, `:530` `headroomFor` | yes — `readFleetSettings`, `:529` | **NO** | yes (re-reads manifests per tick) |
| **`plot-dispatch.sh --start`** (`:283`, `:1928-1952`) | yes — imports `fleet-size.ts`, passes `headroomFor` | no — counts live pids on disk (`:1865`) | **NO** | no — counts `.plot-worker.pid` files |

I verified the in-flight blindness directly: `grep -rn "readInFlight\|in-flight\|inFlight"` over `registryd-main.ts` and the queue rule returns **nothing**. `grep -rln auto-in-flight` returns only `in-flight-store.ts`, `fleet.ts`, `auto-dispatch.ts`, and the two built bundles — **board-side files only**.

**What they DO share:** the `parallelAgents` value (board and supervisor both via `readFleetSettings`) and the agent registry. That is a real floor and it is why the estate is not worse than it is.

**What they share NOTHING of:** the in-flight window, and the machine reading. Each takes its **own fresh sample** at its own moment. Three independent samples of one quantity, no coordination.

### Does a ratchet in one survive the others? — the decisive question

**It survives, and it is not defeated. Here is the evidence, and it is the opposite of what I expected to find.**

**The supervisor already has a tight ratchet-equivalent, and it is stricter than the board's.** `packages/domain/src/rules/fleet-size.ts:96` declares `const TIGHT_CEILING = 2`, `:83` `const STARVED_CEILING = 1`, and `ceilingFor` (`:163-171`) applies them. So on a tight reading the supervisor may start **at most 2** and a starved one still gets **1** — never zero, deliberately (`:78-82`: *"A starved machine that starts nothing is a fleet that can never recover on its own"*).

**More: `fleetSize` subtracts what is already running BEFORE the ceiling** (`:129`, `wanted = requested - running`). That is precisely the memory the board lacks. The supervisor asks *how big should the fleet be* and subtracts reality; the board asks *is one more fork affordable* and subtracts nothing but its own in-flight marks.

**So the supervisor is not an equal co-offender that defeats the board's ratchet.** It is bounded twice over — by `size: settings.parallelAgents` minus running, and by the tight ceiling of 2 — and further rate-limited to `DESKS_PER_TICK = 3` per 60-second tick (`registryd-main.ts:482`). The board's loop, by contrast, runs on a **5-second cadence** with no per-band ceiling at all. At 46 ms parked, that is **12 dispatch decisions per minute against the supervisor's one tick**.

**That asymmetry is the finding, and it vindicates the plan's scoping decision rather than undermining it.** The board is the unbounded caller. The supervisor already implements, in `fleet-size.ts`, the shape the plan proposes to add to the board. Fixing the board is not one of three equal fixes — it is the fix to the only caller with no band-aware bound.

**And `--start-agents` is opt-in.** `registryd-main.ts:789,794` gate the fleet cap and `startAgents` behind `args.startAgents`; `:139` parses the flag; a run without it decides and performs nothing. During the incident it was the operator and the board that were unbounded.

### Where I judge the scoping to be a clean slice

- The board's ratchet touches `auto-dispatch.ts` only. No signature in `fleet-size.ts` changes, so the supervisor and `plot-dispatch.sh --start` are byte-identical after this plan.
- The three callers converge on one rule module already. A later shared ratchet has an obvious home (`fleet-size.ts`, beside `ceilingFor`) and this plan does not block it or make it harder.
- Open Question 1 names the follow-up honestly and correctly marks it non-blocking.

### Where the scoping is thinner than the plan admits

**The plan says three spawners "each honoured a cap none of the others could see" (line 144).** From my map that is **half right and the inaccurate half flatters the board**. Board and supervisor DO see one cap — `parallelAgents`, read from the same `fleet-settings.ts`. What none of them shares is the **machine reading** and the **in-flight window**. Stating it as three blind caps overstates the isolation; the precise statement is *three independent machine samples and one shared agent cap that counts the wrong noun*. The plan's own line 72 already says the cap counts the wrong noun, so the correction is internal consistency rather than new information.

**The genuine residual risk my lens does see:** the ratchet makes the board dispatch on roughly one pass in N instead of every pass. The supervisor, on its own 60 s tick, keeps handing out up to 2 per tight tick. Neither counts the other's starts within the in-flight window. So the ceiling after this plan is *lower and still not jointly bounded*. The plan says exactly this in Open Question 1 and in Notes, and does not claim otherwise. **A fix that reduces an unbounded loop to a bounded one is worth shipping before the shared-state work, not after** — the alternative is leaving the 5-second caller unbounded while a harder cross-process design is argued.

## 6. The single strongest argument AGAINST doing this at all

**The board's loop already has a shared, persisted, TTL'd, cross-process budget mechanism for exactly this class of problem — the in-flight store — and this plan adds a second, unrelated piece of dispatch state beside it instead of extending it.**

`in-flight-store.ts:5-42` is a board writing *I have already spent this slot* where every board can read it, with expiry so a dead board's budget returns. That file exists because the previous attempt to remember a dispatch in process memory failed against a second board. The tight ratchet is the same shape of question — *have I already spent a tight dispatch* — and the plan proposes it as "one bit beside the existing controls" (line 87) with no statement of where that bit lives or whether a second board sees it.

**The honest force of this objection is that it argues for amending the plan, not abandoning it.** The ratchet is right, the diagnosis is right, the scoping is right. What is missing is one sentence in `Done when` pinning the bit's home and its behaviour on `unmeasured`. Two boards on one repo is a case this estate has already been bitten by and has already built the machinery for.

## Recommended amendments

1. **Pin where the ratchet's state lives** in `Done when`, and say whether a second board on the same repository observes it. Cite `in-flight-store.ts:5-13` as the measured precedent for why process memory is not enough.
2. **Name what `unmeasured` does.** Three readings (`clear` resets / `unmeasured` resets / `unmeasured` latches) all pass every currently stated gate and one of them can wedge the fleet permanently. Pin it with a test.
3. **Correct the median: 46.6, not 46.4.**
4. **Amend line 144** to what is actually true: the board and supervisor share `parallelAgents` via `fleet-settings.ts`; what is unshared is the machine reading and the in-flight window.
5. **Record the supervisor's existing bound in the Open Question** — `fleet-size.ts:83,96` `STARVED_CEILING=1`/`TIGHT_CEILING=2`, applied after subtracting `running`. It is the strongest available evidence that scoping the supervisor out is safe, and the plan currently argues that case without its best fact.

None of these changes the slice's shape or its branch. All five are edits to the plan text and one added test.

Verdict: amend

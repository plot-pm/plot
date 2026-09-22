# Panel moderation — the board asks the process, not the desk

**Subject:** `docs/plans/2026-09-22-the-board-asks-the-process-not-the-desk.md`
**Commitment:** `Position: proceed|amend|reject`
**Reconciliation:** `unanimous` — `amend=premise,reading,consequence`. **3 of 3 gated. Nobody said reject.**

| Lens | Evidence | Position |
|---|---|---|
| premise | **Tried to break the claim; ran `matchQueue` with the state forced** | amend |
| reading | **Probed five synthetic desks against the real shell** | amend |
| consequence | **Traced ten readers across four groups** | amend |

## The first plan on this defect nobody rejected

Three attempts were rejected outright. **This one is amended by all three lenses and refuted by none** — the premise survived a juror trying to break it, the layer is right, and the fix is smaller than proposed. The amendments are corrections the plan can absorb.

## The premise is TRUE and my evidence for it is WRONG

The juror could not break the claim. It broke the number I used to support it.

**`no-free-agent=0` is a count of a line that did not run.** `rules/queue.ts:249` increments it inside the slice loop *after* the readiness gate:

```
not-claimable=265 + no-brief=1 = 266 = held
```

All 266 took the first `continue`. The `next >= free.length` test never executed. **The counter reads 0 whether the free list holds three agents or none.**

The juror proved the direction directly — running `matchQueue` with the three agents' state forced to `finished`:

```
handed=0, held=[{hold:'no-free-agent'}], idle=0
```

**`no-free-agent` counts UP when agents are not free.** I had the causal direction of my own headline number backwards.

**What does prove it is in the tick line I quoted and did not use: `idle=3`.** `queue.idle` is `free.slice(next)` — sliced straight off the free list computed by `isAgentFree`, with no slice-level gating in front of it. `idle=3` against `agents=3` says all three passed. That is the measurement, and it was on screen all along.

## What each lens amended

### Premise — replace the evidence, and the done-when is not a test

`no-free-agent=0 before and after` **will read 0 after the change for the same reason it reads 0 now**, and would read 0 if the change broke `isAgentFree` outright. It discriminates nothing. `idle=3 agents=3` does.

### Reading — the site is one line and I named three that aren't it

The change goes at **`registry.ts:811-814`** (`refreshStates`, the assignment) over **`:865`** (`bashLiveness`, the derivation). The lines I cited are a doc comment, a membership filter and a `const`.

**`finished` + live pid has five ways in, not one.** Probed against the real shell:

| desk | PR fact | answer |
|---|---|---|
| clean | `''` | `finished` |
| dirty | `''` | `stalled` |
| **dirty** | **`pr`** | **`finished`** |
| **blocked** | **`pr`** | **`finished`** |
| blocked | `''` | `waiting` |

`taskState`'s **first** arm is `hasPr`, which outranks `blocked` and `dirty` both — so my "the shell tests stalled and waiting before finished" is false as an arm-order claim.

**What saves the fix is a fact I never stated:** `registry.ts:870` hardcodes an empty PR argument, so those two rows are unreachable on this path. **The guard is an argument literal three lines from the change, not the arm order** — and a plan whose safety argument is wrong is dangerous even when the code is right.

**And a second reader shares the resolver:** `drop.ts:151` `classifyState` calls the same `LivenessResolver`.

### Consequence — this is not a display change

**`autoDispatch: true` on this machine right now.** The registry row's `state` feeds `liveAgentCount` and `freeAgentCount`, which are both halves of auto-dispatch's budget:

```ts
let budget = controls.parallelAgents - (liveCount + inFlight.size);
if (budget <= 0) { budget = freeAgentCount(agents, pulse); … }
```

**Flipping three rows from `finished` to `running` changes what the board starts**, and my done-when never mentions it. `pruneInFlight` also reads `LIVE_STATES` to decide which in-flight marks retire.

Ten readers traced; seven are honest improvements. `fleet.ts:7642`'s own comment demands its count equal what WORKING renders — today it is 0 with three agents live, so **the plan fixes a stated invariant.**

## The pattern across five panels today

Four plans, four times the same author error: **a small sample written as a property.** One desk standing for three, one outlier standing for a distribution, one day standing for the estate, and now one counter standing for a claim it cannot support.

Each time the juror's first move was to widen or re-derive the reading. Three times that reversed the conclusion; **this time it confirmed it and replaced the argument.**

## What the moderation recommends

**Amend, then approve. The layer is right and the fix is smaller than written.**

1. **Swap `no-free-agent=0` for `idle=3`** everywhere — the quoted block, the reframing argument, and the done-when, which becomes `idle=3 agents=3`.
2. **Name the site:** `refreshStates` at `registry.ts:811-814`, over `bashLiveness` at `:865`. Note `drop.ts:151` shares the resolver.
3. **State the real guard.** The empty PR argument at `registry.ts:870` is what makes `finished` unambiguous here — not the arm order, which is wrong. A comment at the change should say so, because a later caller passing a PR fact would silently widen it.
4. **Add auto-dispatch to the done-when.** `liveAgentCount`, `freeAgentCount` and `pruneInFlight` all shift. Decide deliberately whether three agents becoming visible *should* change the budget — the consequence juror's reading is that it should, since they genuinely occupy slots, but it must be a decision rather than a side effect.
5. **Keep the three exhibits honest.** All three live desks are dispatched workers between slices, not never-dispatched free agents. The fix covers them; the description should match.

**Nothing is approved and nothing is dispatched.** The plan is Draft and stays Draft until amended.

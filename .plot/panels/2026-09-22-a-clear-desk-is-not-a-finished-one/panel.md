# Panel moderation — a clear desk is not a finished one

**Subject:** `docs/plans/2026-09-22-a-clear-desk-is-not-a-finished-one.md`
**Commitment:** `Position: proceed|amend|reject`
**Reconciliation:** `unanimous` — `reject=measurement,blast-radius,discriminator,vocabulary`. **4 of 4 gated. Nobody said proceed or amend.**

## A unanimous panel is reconciled too, and here the agreement is not a blind spot

Four lenses were given four different rubrics and reached one position by four independent routes. Two of them — measurement and discriminator — arrived at the *same counterexample* from opposite directions without coordinating, and the other two never needed it.

| Lens | Evidence | Position |
|---|---|---|
| measurement | **Re-took every reading, then took the one the plan did not** | reject |
| discriminator | **Enumerated the live worktrees and read `reset_desk` in source** | reject |
| blast-radius | **Traced all fourteen consumers of `AgentState`** | reject |
| vocabulary | Read four live meanings of `idle` against the specs | reject |

## What survives, and it is most of the plan

**The measurement juror re-took every stated reading and all of them hold**: three pids alive with one `sleep 60` child each, all three answering `finished`, the tick at `agents=3 idle=3 handed=0`, and `grep -c detached` returning 0 on the corpus. It notes the plan *understates* its own case — 264 slices held while three agents sit idle.

**All seven causal links hold**, checked line by line:

> No link fails. This is the first of the three plans whose causal story survives independent re-reading intact.

**The domain half of the fix is correct.** With `taskState` answering a new state and `isAgentFree` accepting it, a free agent reaches `matchQueue`, `whyNotFree` returns `''`, and the tick hands work over. That is the exact link the first panel found fatal in the first attempt, and this plan closed it.

**So the diagnosis is right for the third time and the fix is wrong for the third time.**

## Why it is rejected: four findings, each fatal alone

### 1 · The discriminator is false on two of the plan's own three desks

The plan asserts its three named desks are `HEAD detached, branch ''`. Measured:

```
.worktrees/free-fe7ff576     899ad861a (detached HEAD)
.worktrees/free-c810e5bb     327056283 [feature/the-call-asks-only-for-the-delta]   ← ATTACHED
.worktrees/free-719604d9     a75571c7f [bug/the-status-asks-the-process-table]      ← ATTACHED
```

**All three are free agents** — every manifest reads `branch: ""`. So a free agent's desk that is not detached exists twice over, among the three the plan cites as its evidence.

Under the proposed rule, `free-fe7ff576` becomes dispatchable and the other two keep reading `finished`. **The done-when — *a tick against three idle agents reports `handed=1`* — would fail**, and which desk happens to be fixed depends on whether it took a slice earlier.

**The mechanism, read in source:** `plot-dispatch.sh:2057` does cut a free desk `--detach`. But `plot-worker-loop.sh:960-968`'s `reset_desk` runs `checkout --detach` then `checkout -b <branch>`, and **nothing re-detaches when the slice ends** — `reset_desk` only runs on the next hop, so a desk sits on its last slice's branch for the whole waiting period. That is precisely this plan's population.

**The moderation's own reading of this:** the second panel demanded a launch-time fact. Detachment satisfies both stated halves — git records it at creation, the starting party writes it — and fails an unstated third: **the fact must still be true when it is read.** A launch-time fact that mutates mid-life is worse than one that was never true, because it reads as durable.

### 2 · `idle` is taken, in the same file, by a standing refusal of this change

`entities/agent.ts:49`:

```ts
export const AgentActivitySchema = z.enum(['working', 'idle', '']);
```

Ten lines below `AgentStateSchema`, with a comment reading *"A cue on a `running` agent, never a ninth state… see the state enum above."* **The plan's slice is to add `idle` to the enum that comment points at.** Four live meanings were found; `rules/queue.ts:161`'s `QueueMatch.idle` — *a free agent that got no slice this pass* — inverts the plan's sense.

**This is the first panel's finding repeated with a different word.** That panel rejected `free` for colliding with `rules/free.ts`. This plan renamed the state and collided harder.

### 3 · `tsc` names two consumers, not fourteen

The plan's central mitigation is that *"`STATE_SOURCE` is exhaustively keyed, so `tsc` names every site that must decide."* Traced: **two compile errors, eleven silent behaviour changes.** The plan names one of the two; `NEXT` at `transitions/agent.ts:66` is the other and goes unmentioned.

The silent eleven include two the done-when depends on:

- **`isLiveState` is a DENYLIST** — `!NOT_LIVE_STATES.has(state)` — so a new state reads **LIVE silently**. The schema's own docstring names this hazard: *"Widening the enum without widening this is the measured hazard."*
- **`agentStateStatus`'s `switch` has `default: return ''`**, so an agent in WORKING renders with a blank status word — the very section the done-when requires.

**A mitigation that was checked would have found this.** I asserted `tsc` covers it; I did not trace the consumers.

### 4 · The estate refuses it in writing

`corpus/agent-state.corpus.test.ts` pairs the shell against `agentState`, and `AgentStateSchema` excludes availability words by design. The first panel established this and the plan cites it correctly — then proposes a ninth state anyway.

## The author's error, and it has one shape

**I measured one desk and generalised to three.** `free-fe7ff576` is detached; I checked it, wrote *"HEAD detached, branch ''"* as a property of the population, and did not run `git worktree list`. The juror ran it.

This is the same failure the second panel named about its predecessor — *"it named a discriminator without reading what already answers the question"* — in a new form: **it named a discriminator without reading whether it holds on the cases it cites.** Three plans, three wrong discriminators, and the diagnosis correct every time.

## What the moderation recommends

**Reject and stop proposing a ninth state.** Three attempts have now failed on the same move, each on a different fatal ground: `free` collides, a pid-alive arm over-fires, `idle` collides and mutates. The estate has said no three times in three different vocabularies.

What a fourth attempt must start from, on which all four jurors agree:

1. **Keep the diagnosis whole.** Seven links, independently verified; the root-exclusion analysis now endorsed by nine jurors across three panels.
2. **The discriminator must be true when READ, not only when written.** Every candidate must be checked against all three live desks, not one.
3. **`.plot-worker.wrapper.pid` is the estate's precedent** for *what proves a worker ran here* — a file the starting party writes that nothing later overwrites. The free path could write an equivalent.
4. **Consider not adding a state at all.** `rules/free.ts` is where availability is decided, `queue.ts:161` already has a word for a free agent, and the manifest's `branch: ""` is true on all three desks right now while every other candidate reading is not. A plan that changes what `isAgentFree` READS, rather than what `agentState` ANSWERS, has none of findings 2, 3 or 4 against it.
5. **If a state is still wanted, trace all fourteen consumers first** — `isLiveState`'s denylist and the two `default: return ''` switches by name.

**Nothing is approved and nothing is dispatched.** The plan is Draft and stays Draft.

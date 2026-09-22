# Discriminator lens — a clear desk is not a finished one

Position: reject

**The discriminator is refuted by measurement, on the plan's own three desks.** Two of the three free agents it was written from hold a branch. Under the proposed rule they keep reading `finished` and stay undispatchable — the defect survives on 2 of 3 cases the plan cites as its evidence.

## 1. Does detachment separate the populations?

**No. Measured 2026-09-22, `git worktree list` in this repo:**

```
.worktrees/free-fe7ff576     899ad861a (detached HEAD)
.worktrees/free-c810e5bb     327056283 [feature/the-call-asks-only-for-the-delta]   ← ATTACHED
.worktrees/free-719604d9     a75571c7f [bug/the-status-asks-the-process-table]      ← ATTACHED
```

These are the plan's own three desks, named at `design.md` lines 24–26 and asserted at line 65 to be `HEAD detached, branch ''`. **That assertion is true of one of them.**

**All three are free agents,** and the registry says so itself — every manifest in `.plot/agents/` reads `branch: ""`:

```
 | (empty) | free-719604d9
 | (empty) | free-fe7ff576
 | (empty) | free-c810e5bb
```

So the counterexample the rubric asks for exists twice over: **a free agent's desk that is NOT detached.** `free-c810e5bb` and `free-719604d9` are attached, free, alive in `sleep 60`, and are exactly the agents the plan exists to rescue.

**All three desks are identically clear** — the readings that feed `taskState` are the same for every one:

| desk | attached? | dirty | PLOT-BLOCKED | unpushed |
|---|---|---|---|---|
| free-fe7ff576 | detached | 0 | 0 | unaskable |
| free-c810e5bb | **branch** | 0 | 0 | unaskable |
| free-719604d9 | **branch** | 0 | 0 | unaskable |

**So the proposed split produces a partial fix that looks total.** `free-fe7ff576` → `idle`, dispatchable. The other two → `hasSlice: true` → `finished`, still invisible to the board, still rejected by `isAgentFree`. The done-when *"a supervisor tick against three idle agents and one claimable slice reports `handed=1`"* would fail: only one of the three becomes eligible, and which one depends on whether it happened to have taken a slice earlier.

### The mechanism, read in source

`plot-dispatch.sh:2057` does cut a free desk `--detach`, as claimed. But detachment is **not preserved across the desk's life**, because `reset_desk` attaches a branch when the agent takes a slice — `plot-worker-loop.sh:960-968`:

```
git -C "$wt" checkout --detach "origin/$main_branch"   # step 1
git -C "$wt" checkout -b "$branch"                     # step 2 — ATTACHED, and it stays
```

Under `an-agent-holds-one-desk` the desk **outlives the slice**. Nothing re-detaches it when the slice ends: `reset_desk` is only called on the next hop (`plot-worker-loop.sh:2261`), so a desk sits on its last slice's branch for the whole waiting period. That is precisely the population this plan targets — an agent between slices.

## 2. Is it a launch-time fact?

**It is a launch-time fact that does not stay true.** Git records it at creation, the party that starts the agent writes it — both halves of the panel's requirement hold at t=0. But the panel's requirement has an unstated third clause the plan needs and does not have: **the fact must still be true when it is read.** `reset_desk` overwrites it mid-life with two ordinary `git checkout` calls.

Answering the rubric directly: **yes, something checks out a branch in a free desk — the free agent itself, every time it takes a slice.** So the reading is launch-time *in provenance* and mutable *in fact*, which is the worse of the two properties, because it reads as durable.

The plan's line 69 — *"readable forever after without asking any process"* — is false. It is readable forever; it does not mean forever what it meant at creation.

## 3. Is the reading available where it is needed?

Yes, cheaply, on both sides — this is the one rubric item the plan passes. The shell already runs `git -C "$wt"` in `plot_worker_task_state` (`plot-worker-state.sh:723`), so `symbolic-ref -q HEAD` is one more local call. The domain takes readings as values; `readingsFrom` in `packages/board/src/server/entry/agent-state.ts:98` parses a tab line, so a field appends. No port, no I/O, no cost argument.

**Availability is not the problem. Validity is.** A cheap reading of the wrong fact is still the wrong fact.

## 4. The states the plan says it does not touch

**Verified — the arm ordering does give what is claimed.** `taskState` tests `blocked` and `dirty` before the final arm (`task.ts:88-92`), and the proposed edit changes only `return 'finished'` to `return readings.hasSlice ? 'finished' : 'idle'`. A free desk with a marker still returns `waiting`; one with uncommitted work still returns `stalled`. The claim at line 95 and the done-when at line 118 are sound.

The guards on `workerAlive`, `dropSettledWorkers` and `agentState`'s arm ordering are also correct as stated, and `orphaned` is the right entry point — the second panel's finding is honoured. **The plan's structure is right and its discriminator is wrong**, which is why this is reject rather than amend: the slice as written ships the wrong reading into the corpus pair, `AgentStateSchema` and the board.

## 5. Is there a better discriminator?

**Yes, and it is already the registry's answer: the manifest's `branch` field.**

All three desks read `branch: ""`. That is the fact that actually separates the populations here, it is written by the party that starts the agent (`plot-dispatch.sh:2083` — *"`write_agent_manifest` writes `\"branch\": \"\"`"*), and `isAgentFree` **already reads it** (`free.ts:85`). It is also maintained across the desk's life by the loop rather than silently invalidated by it.

I flag one thing rather than endorse it outright: a plan proposing this must verify who clears `branch` when a slice ends, and must reckon with `free.ts`'s own warning that a *landed* slice counts as holding none. That is a different plan's work, and the measurement above is the input it needs.

**Two further candidates the plan did not weigh:** `.plot-worker.envelope.json` — named by a juror in the previous panel, per-branch, absence load-bearing (`plot-worker-loop.sh` documents both properties) — and a desk that never held a slice having no envelope at all. The plan cites neither.

## On the appeal to PR #961

The plan's line 71 claims detachment here is *"the same reading PR #961 ships for the reaper."* **It is not the same reading, and #961's own contract test says so.** #961 uses detachment to answer *does this desk carry anything to land* — and pairs it with a commit check, keeping a detached desk that carries commits (`reap-detached-desk.test.mjs`: *"A DETACHED DESK CARRYING COMMITS IS KEPT. The 'nothing to land' reading must not become 'detached means disposable'"*). This plan uses detachment to answer *did this agent ever have a slice*, unpaired. Borrowing the reading without its guard is what makes the false negative.

**And the estate has already rejected this inference by name.** `rules/unclaimed.ts:22-27`:

> **THIS IS THE CLAIM, AND A DETACHED DESK CAN CARRY ONE.** The plan read *a detached tree can never be claimed, so it is unclaimed by construction*; measured on this estate 2026-09-09, two of six registered agents held a DETACHED desk … Deriving the claim from the HEAD shape would have reported both of them as leftovers while their workers ran.

That is the mirror image of this defect, measured on this estate, with the same conclusion: **the HEAD shape does not classify a desk.** `slice-tokens.ts:133-145` records the other half — the between-slice detach is *"invisible by construction"* because `reset_desk` detaches and re-attaches in two consecutive calls.

## What I verified and did not fault

The causal chain (lines 36–42) holds; I re-read every link. The root-exclusion analysis is sound. The `orphaned` starting point answers the second panel correctly. The `idle`-not-`free` vocabulary argument is correct and the `isAgentFree` change at line 102 is the right fix for the first panel's fatal finding. The arm-ordering claims check out. **The plan is wrong in one place, and it is the load-bearing one.**

## The method finding

The previous moderation wrote: *"It does not re-verify the code, and the code moved."* This plan re-verified the code and **did not re-verify its own measurement.** Lines 24–26 record three desks; line 65 makes a claim about their HEAD shape; two of the three contradicted it, and the contradiction is visible in one `git worktree list`. The three pids are quoted from a reading taken earlier the same day — the desks kept working after it was taken.

A fourth attempt should start from the measurement above rather than from this panel.

Position: reject

# Juror verdict — the measurement lens

**Subject:** `docs/plans/2026-09-22-a-clear-desk-is-not-a-finished-one.md`
**Lens:** measurement — every stated reading re-taken on the live estate, 2026-09-22.


## The headline

**Every measurement in the plan reproduces. The discriminator the plan is built on does not hold on two of the three desks it was written to fix.**

The plan is the best of the three attempts: the chain is right at all seven links, the pids are alive, the tick is exact. It then picks detachment as its discriminator and does not re-take that one reading on the desks it names. I took it. It fails 2 of 3.

## 1 · Are the plan's measurements reproducible right now? Yes — every one

| Plan's claim | My reading | Verdict |
|---|---|---|
| pid 243 alive in `sleep 60` | alive, `bash plot-worker-loop.sh`, etime 05:33:06, one child `sleep 60` | **holds** |
| pid 6542 alive in `sleep 60` | alive, etime 04:47:20, one child `sleep 60` | **holds** |
| pid 27820 alive in `sleep 60` | alive, etime 05:05:54, one child `sleep 60` | **holds** |
| all three read `finished` | `plot_worker_state` → `finished\|243`, `finished\|6542`, `finished\|27820` | **holds** |
| no `claude` child on any | confirmed, `pgrep -P` returns exactly one `sleep 60` each | **holds** |
| `grep -c detached` on the corpus returns 0 | returns **0** | **holds** |

The supervisor tick, re-taken (`plot-registryd.mjs --once`, cost 10555 ms):

```
agents=3 left=3 reap=0 correct=0 person=0 defer=0 handed=0 held=264
idle=3 already-merged=0 merge-unknown=0 no-brief=1 not-claimable=263
no-free-agent=0 unclaimed=14
```

`agents=3 idle=3 handed=0` — **exactly as stated.** The plan reports the tick honestly and even understates its own case: 264 slices are held while three agents sit idle.

All three manifests confirm genuine freedom — `branch: ""` on every one. This is not a plan that invents numbers.

## 2 · Is the causal chain real? All seven links hold

| Link | Claim | Read at |
|---|---|---|
| 1 | `:860` alive wrapper, no agent → `$? -eq 1` | `plot-worker-state.sh:867-873`, the `elif [ "$?" -eq 1 ]` arm. Comment reads *"The DESK decides what that means"* — quoted correctly |
| 2 | routes to `plot_worker_task_state` | verbatim at `:872` |
| 3 | clear desk → `finished` | confirmed live on all three |
| 4 | `agent-state.ts` does the same | `:140` — `if (readings.liveness === 'orphaned') return taskState(readings.task);`, and the comment naming the ordering is there |
| 5 | `task.ts` ends `return 'finished'` after four false readings | verbatim, all four arms as quoted |
| 6 | `isAgentFree` opens on `!== 'running'` | `free.ts:64-67` verbatim |
| 7 | `queue.ts:249` filters with it | verbatim: `const free = readings.agents.filter((agent) => isAgentFree(agent.reading));` |

**No link fails.** This is the first of the three plans whose causal story survives independent re-reading intact. Credit where due.

## 3 · Does the proposed fix fix the measured symptom? The domain half yes; the shell half no

The domain trace is sound. With `taskState` returning `idle` and `isAgentFree` accepting it, a free agent reaches `matchQueue`'s free list, `whyNotFree` returns `''`, and the tick hands work over. That link is real and the plan states it explicitly — the exact link the first panel found fatal. **It is fixed.**

**But the fix only fires where `hasSlice` reads false, and on this estate it reads TRUE on two of the three desks.**

## 4 · What the plan did not measure, and it is the one that makes it wrong

**The plan never took the detachment reading on the three desks it names.** It asserts it from a sample of two:

```
.worktrees/free-fe7ff576        HEAD detached, branch ''    ← plot-dispatch.sh --start, cut --detach
.worktrees/reaper-free-desk     branch bug/the-reaper-…     ← a dispatched slice
```

One free desk, one dispatched desk. I took it on all sixteen:

```
free-04517165  detached      free-719604d9  BRANCH  bug/the-status-asks-the-process-table
free-096be20a  detached      free-c810e5bb  BRANCH  feature/the-call-asks-only-for-the-delta
free-2a5e7c4a  detached      free-af780185  detached
free-46b0b1f3  detached      free-b2023483  detached
free-543c91e7  detached      free-ecbaa662  detached
free-56ce87e5  detached      free-f69f5e66  detached
free-5eef1bd2  detached      free-fe7ff576  detached
free-678dccef  detached      free-6f5e58e9  detached
```

**Two of the three desks in the plan's own measurement block are on branches.** `free-c810e5bb` (pid 6542) holds `feature/the-call-asks-only-for-the-delta`; `free-719604d9` (pid 27820) holds `bug/the-status-asks-the-process-table`. Both have `branch: ""` in their manifests — they are free by every other reading, and their git HEAD says otherwise.

### Why, and it is structural rather than an accident of this estate

`plot-worker-loop.sh`'s `reset_desk` (`:962-969`):

```bash
git -C "$wt" checkout --detach "origin/$main_branch"   # step 1
git -C "$wt" checkout -b "$branch" && return 0          # step 2
git -C "$wt" checkout "$branch" && return 0
```

A desk is detached only *in transit*. It comes to rest **on the slice's branch**, and nothing detaches it again when the slice ends — the loop goes straight to `wait_for_work` and polls in `sleep 60` with the branch still checked out. The desk's git HEAD records the *last slice it worked*, not whether it was cut for one.

So detachment is **not** the launch-time fact the plan claims. It is a launch-time fact that the loop overwrites on the first slice, and never restores. `free-fe7ff576` is still detached only because it has never taken a slice. The plan measured the one desk that had not yet falsified its own discriminator.

**The consequence is precise:** `hasSlice` reads TRUE for pids 6542 and 27820, `taskState` returns `finished`, `isAgentFree` rejects them, and the supervisor still reports `idle=2 handed=0`. **The plan fixes one of the three agents it was written for**, and the two it misses are the two that have actually done work — the steady state of any agent that has run more than once.

This is the reading whose absence makes the plan wrong, and the rubric asked for it by name.

## 5 · Stated as measured, actually inferred

**Three.**

1. **The detachment table.** Presented as measurement, generalised from two desks to two populations. Refuted above, 2 of 3.

2. **PR #961 as shipped precedent.** The plan writes: *"It is the same reading PR #961 ships for the reaper, which is evidence the estate already treats detachment as the free-desk signal rather than an invention here."* I asked the host:

   ```
   {"number":961,"state":"OPEN","draft":false,"mergeCommit":""}
   ```

   **#961 is open and unmerged.** An unmerged PR is a proposal, not the estate's practice, and "already treats" is not true of it. What the estate does hold is `reapable.ts:28` — *"The branch checked out, or `''` when the head is detached"* — which reads the same field for a different question and grants no precedent for equating it with *was this cut for a slice*.

3. **"They finished their previous slices hours ago and released their `branch` fields to `''`."** Correct for 6542 and 27820 — and it is the plan's own sentence explaining why its discriminator cannot work. A desk that finished a previous slice is still standing on that slice's branch. The plan states the mechanism that refutes it and does not follow through.

## What survives, and it is most of the plan

- The seven-link chain — verified whole, the first time across three attempts.
- The root-exclusion analysis — a sixth juror endorsement.
- `idle` as the noun, against `free`. The collision with `rules/free.ts` and `DESIGN-agent.md:487` is real and correctly avoided.
- **The `isAgentFree` change.** Fixes the first panel's fatal finding.
- The guards on `workerAlive`, `dropSettledWorkers`, arm ordering and the five reap refusals.
- Starting from `orphaned` — the second panel's demand, met.

**Only the discriminator fails.** But `hasSlice` is the whole mechanism, and a rule fed a reading that is wrong on the majority of its population is the defect this plan set out to fix, one layer down.

## What a fourth attempt needs, from the measurement side

The discriminator must be a fact **no later process overwrites**. Git HEAD is not — the loop rewrites it per slice. Two candidates the estate already holds, neither of which I am specifying as the answer:

- **`.plot-worker.envelope.json`.** Present on `free-c810e5bb` and `free-719604d9`, **absent on `free-fe7ff576`** — a measured 3-of-3 split that tracks *has this desk ever run a slice*, written by the launching party. Named by a juror in the second panel as a candidate with load-bearing absence. It is the inverse of what the plan wants, which is worth noting: it marks the desks that HAVE worked.
- **The manifest's `slug`.** `free-719604d9` carries one, the other two do not — a 1-of-3 split, so it measures something else.

Whichever is chosen, **take the reading on every desk before writing the plan.** All three attempts have now failed on a discriminator that was argued rather than counted, and the count took one shell loop each time.

## Position

Position: reject

The measurements are honest and reproduce exactly; the chain is right; the domain fix is right. The discriminator is refuted on 2 of the 3 desks the plan names, by a mechanism the plan itself describes, and it is load-bearing. That is a rejection of the fix, not of the diagnosis — which is now verified six ways and should be carried forward whole.

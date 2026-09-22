# Blast-radius verdict — a clear desk is not a finished one

**Subject:** `docs/plans/2026-09-22-a-clear-desk-is-not-a-finished-one.md`
**Lens:** blast radius — every consumer of `AgentState` and `TaskReadings`, and what each does with the new member.

Position: reject

---

## The headline, before the rubric

The plan's central mitigation is one sentence: *"`AgentStateSchema` is a Zod enum and `STATE_SOURCE` is exhaustively keyed, so `tsc` names every site that must decide about `idle`."*

**I traced every consumer. `tsc` names TWO of them.** Eleven others compile clean and change behaviour, and three are the fleet's own dispatch path. Beyond that, two findings are fatal on their own and neither is a consumer question:

- **`idle` is already taken**, in the same file, for a different fact — and a test asserts by name that it must never become an `AgentState`.
- **The discriminator is false on this machine right now.** Two of the three desks the plan measured are *on branches*, not detached.

---

## 1 · Who consumes `AgentState`?

Fourteen readers. I group them by what happens when `idle` arrives.

### 1a · The two `tsc` actually catches

| Site | Shape | What breaks |
|---|---|---|
| `transitions/agent.ts:43` `STATE_SOURCE` | `Readonly<Record<AgentState, StateSource>>` | **Compile error.** Missing key. The plan names this one. |
| `transitions/agent.ts:66` `NEXT` | `Readonly<Record<AgentState, readonly AgentState[]>>` | **Compile error.** Missing key. **The plan does not name it.** |

`NEXT` is the more interesting of the two, and see §4.

### 1b · The eleven that compile clean

| Site | What it does with `idle` |
|---|---|
| `contract/schema.ts:3214` `AgentStateSchema` | Spreads `...DomainAgentStateSchema.options`, so `idle` **propagates automatically** into the board's ten-member enum. No error, no decision. |
| `contract/schema.ts:3255` `NOT_LIVE_STATES` | A hardcoded seven-string `Set<string>`. `idle` is **not** in it. |
| `contract/schema.ts` `isLiveState` | **A DENYLIST** — `!NOT_LIVE_STATES.has(s)`. So `idle` reads **LIVE**, silently and by design. The schema's own docstring names this exact hazard: *"Widening the enum without widening this is the measured hazard."* |
| `contract/schema.ts` `isBrokenState` | Allowlist; `idle` reads not-broken. Correct by luck. |
| `server/registry.ts:56` `KNOWN_STATES` | Derived from the enum, so `idle` is admitted as a shell answer. Correct by construction. |
| `server/registry.ts:813` | `KNOWN_STATES.has(answer) ? answer : 'unknown'`. Passes `idle` through. Correct. |
| `app/lib/tuple-row.ts:883` `workerStatus` | `switch` with `default: return ''`. An `idle` **branch row renders as an empty status word.** Silent. |
| `app/lib/tuple-row.ts:920` `agentStateStatus` | `switch` with `default: return ''`. **An `idle` agent in WORKING renders with a BLANK status.** Silent — and this is the very section the done-when requires. |
| `server/attention.ts:254` | `switch` with a `default` arm. `idle` falls to the `none`/`elsewhere` arm. Silent. |
| `entities/agent.ts:58` `LIVE_STATES` | Literal `['running','waiting']`. `isLive('idle')` → **false**. So an `idle` agent does **not** hold a machine slot — it is not counted against the concurrency cap, while its process is alive and consuming one. Silent. |
| `rules/free.ts:64` `isAgentFree` | `state !== 'running'` → false. The plan names this and fixes it. |

**Two of the silent eleven are in direct contradiction.** `isLiveState('idle')` is **true** (board renders it as a live worker) while `isLive({state:'idle'})` is **false** (the cap does not count it). Both are "is this agent live?", answered oppositely by two functions in two packages, and `tsc` reports neither.

### 1c · The shell

`plot-worker-state.sh` prints a bare word. Nothing validates it against the enum at the boundary — `registry.ts:813` is the only gate and it admits anything in `KNOWN_STATES`. The five sourcing scripts (`plot-fleet-scan.sh`, `plot-dispatch.sh`, `plot-fleetctl.sh`, the loop, the corpus harness) each `case`/`grep` on specific words. An unhandled `idle` falls through each one's default. None errors.

### 1d · The second enum the plan never mentions

**`WorkerStateSchema` (`entities/fleet.ts:122`) is a SEPARATE eight-member enum** — `running, finished, failed, ended, none, elsewhere, waiting, stalled`. It is not `AgentState`, shares no type with it, and is what `BranchSchema.worker` carries. `plot-fleet-scan.sh`'s `worker_of` calls the *same* `plot_worker_state` and feeds the answer into this field.

So a branch-row worker reading `idle` from the shell fails `WorkerStateSchema.parse`. The plan's `tsc` argument cannot reach this: it is a **runtime Zod validation on a different enum**, and the plan's slice does not list it.

---

## 2 · Does the plan's claim hold that `tsc` names every site?

**No. It is the plan's stated mitigation and it is false.**

`tsc` catches exactly the two `Record<AgentState, …>` maps. It cannot catch:

- **Any `switch` with a `default`** — `workerStatus`, `agentStateStatus`, `attention.ts` all have one. TypeScript's exhaustiveness checking requires a `never` assertion in the default arm; none of the three has one.
- **`Set<string>` membership** — `NOT_LIVE_STATES` is typed `ReadonlySet<string>`, deliberately, so the denylist accepts unknown states. Widening the enum provably does not touch it.
- **`readonly AgentState[]` literals** — `LIVE_STATES` is assignable whatever the enum holds.
- **The spread into the board enum** — `...DomainAgentStateSchema.options` propagates by design.
- **The second enum** — `WorkerStateSchema` is a separate `z.enum`. Adding to `AgentStateSchema` does not touch it, and the disagreement surfaces as a runtime parse failure.
- **Every shell consumer.**

**Where `tsc` WOULD have helped, the tests get there first — and they refuse.** Five assertions fail, four of them by naming `idle` or the count directly:

```
packages/board/test/unit/schema.test.ts:291   expect(AgentStateSchema.options).toHaveLength(9)
packages/board/test/unit/schema.test.ts:292   expect(AgentStateSchema.options).not.toContain('idle')
packages/board/test/unit/schema.test.ts:494   expect(AgentStateSchema.options.filter(isLiveState)).toEqual(['running','waiting'])
packages/board/test/unit/working-agents.test.ts:53  expect(AgentStateSchema.options).toHaveLength(9)
packages/domain/test/agent.test.ts:26         expect(AgentStateSchema.options).toEqual([...eight...])
```

`schema.test.ts:292` is not incidental coverage. Read its comment:

> *"ITEM 6 OF THE PLAN, stated against the cue directly. **The naive fix adds `idle` as an `AgentStateSchema` member**; that would satisfy the render test and quietly change what `isLiveState`/`isBrokenState` classify. So this pins the enum's size AND asserts `idle` is not among its members."*

**A prior plan considered this exact move, rejected it, and left a named gate against it.** The plan proposes the move that gate exists to stop, and does not mention the gate.

---

## 3 · Who consumes `TaskReadings`?

Four production sites, and **one of them cannot answer `hasSlice`.**

| Caller | Can it supply `hasSlice`? |
|---|---|
| `rules/agent-state.ts:140,142,143` — three `taskState(readings.task)` calls | Only if `AgentStateReadings.task` carries it, which means the wire format changes. |
| `board/src/server/entry/task.ts:78` `answer()` | Parses a **4-field tab-separated line** from `plot_worker_task_state`. Adding a field makes it five, and `readingsFrom` **throws** on `fields.length !== 4`. |
| `board/src/server/entry/agent-state.ts:98` `readingsFrom` | Parses a **7-field line** and hardcodes `hasPr: false`. Adding a field makes it eight; it **throws** on `!== 7`. |
| `corpus/agent-state.corpus.test.ts:69` | Asserts `desk.readings.split('\t').length === 7`. **Fails.** |

**Two wire formats, two bundles, two hard length checks, and a corpus assertion — none named in the plan's slice.** Both throw rather than degrade, which is the right design and means this is a build-breaking change across the shell↔domain seam, not an additive one.

**And one caller genuinely cannot answer.** `entry/task.ts` is `plot-task.mjs`, invoked by `plot_worker_task_state` — which receives `$1=worktree $2=pr-fact` and nothing else. It would have to read detachment itself, which means the shell function gains a `git` call inside the scan's per-branch loop. The whole reason `hasPr` travels as a parameter (`plot-worker-state.sh:741`) is that this function runs once per branch under `--offline` and must not fork. Adding a `git symbolic-ref` per branch there is the cost that contract exists to refuse.

---

## 4 · What breaks that the plan did not name

The prior panel's fatal-and-unnamed finding was `isAgentFree`. **This plan has three equivalents, and the first two are each independently fatal.**

### 4a · `idle` is already the estate's word — in the same file, 24 lines away

`entities/agent.ts:48`:

```ts
export const AgentActivitySchema = z.enum(['working', 'idle', '']);
```

`AgentActivity` is the **cue on a `running` agent**, read from the child's CPU. `entities/fleet.ts:140` states the design decision verbatim:

> *"This tells the first from the last WITHOUT promoting `idle` to a ninth `worker` state and WITHOUT adding it to `AgentStateSchema`, whose members are pinned by a test."*

And `tuple-row.ts:888` **already renders the word**:

```ts
case 'running': return activity === 'idle' ? 'idle' : 'working';
```

So after this change the board renders `idle` for two different facts through two different functions: a *running agent whose child's CPU is frozen*, and a *live agent with no slice*. Those take **opposite** moves — the first is *go look, something is stuck*, the second is *hand it work*. One word, one column, two meanings.

**This is the first panel's `free`/`free` collision, reproduced exactly.** The plan opens its vocabulary section with *"`idle` is the new word, and it is not `free`"* and checks the collision it was told about, against `rules/free.ts` and `DESIGN-agent.md:487`. It did not check the collision in the file it is editing.

### 4b · The discriminator is false on this machine, right now

The plan's table:

```
.worktrees/free-fe7ff576        HEAD detached, branch ''    ← a free agent
.worktrees/reaper-free-desk     branch bug/the-reaper-…     ← a dispatched slice
```

`git worktree list`, this session, on the plan's own three desks:

```
.worktrees/free-719604d9   a75571c7f [bug/the-status-asks-the-process-table]
.worktrees/free-c810e5bb   327056283 [feature/the-call-asks-only-for-the-delta]
.worktrees/free-fe7ff576   899ad861a (detached HEAD)
```

**Two of the three desks the plan measured as detached are on branches.** Not different desks — the same paths, the same `free-` prefix, the same session ids.

The mechanism is `plot-worker-loop.sh:937` `reset_desk`, which the loop calls at `:2261` when a free agent takes its next slice:

```sh
git -C "$wt" checkout --detach "origin/$main_branch"   # step 1
git -C "$wt" checkout -b "$branch"                     # step 2
```

**A free desk is not a population. It is a phase.** `plot-dispatch.sh --start` cuts it detached; the loop checks out a branch in place when it takes a slice; `reset_desk` detaches and re-attaches on every hop. Detachment is therefore *not* a launch-time fact that is "readable forever after" — it is a **current** reading that flips every time the desk takes or finishes work.

Worse, it flips in the direction that breaks the plan's own guard. `reset_desk` step 1 leaves the desk **detached** for the window between two `git checkout` calls, and a desk whose branch was deleted after its PR merged sits detached holding a finished slice. Both read `hasSlice: false` → `idle` → **free** → the supervisor hands a second slice to an agent that is mid-hop.

The plan's supporting argument — *"It is the same reading PR #961 ships for the reaper"* — does not transfer. The reaper asks *may I delete this checkout*, and a wrong `detached` there refuses a reap, which costs a sweep. Here a wrong `detached` **hands out work**, which is `matchQueue`'s assignment lock making a double assignment. Same reading, opposite blast radius.

### 4c · `NEXT` compiles-errors, and every fix is wrong

`NEXT` is `Record<AgentState, readonly AgentState[]>`. Adding `idle` forces a key — that much `tsc` catches. **What it cannot catch is the eight existing value arrays**, none of which lists `idle`. So:

- `running: ['waiting','stalled','finished','failed','ended']` — no `idle`. An agent finishing a slice and going idle is `state-unreachable`.
- `finished: ['none']` — no `idle`.
- `idle: [...]` — whatever is written here is unconstrained.

`observeAgentState` **refuses** every transition into `idle`, with `state-unreachable`, and `tsc` reports nothing. The plan's done-when does not mention `NEXT`, `observeAgentState`, or `diagrams/agent-lifecycle.mmd`, which `NEXT`'s docstring names as its source and which would also need the state.

### 4d · The corpus test cannot be "extended" as written

Done-when: *"`corpus/agent-state.corpus.test.ts` covers the detached case on both sides and passes. It covers none today — measured, `grep -c detached` returns 0."*

The `grep -c` is correct — I verified it returns 0. **The inference is not.** `production.ts:523` `readDesks` enumerates `git worktree list` on the machine running the test and compares whatever it finds. There is no case table to extend. `grep detached` returns 0 because the file contains no fixtures at all, not because a case is missing.

Making it "cover the detached case" means either creating a detached desk as a fixture — which contradicts the file's stated design, *"PRODUCTION SUPPLIES BOTH HALVES"* — or relying on the machine happening to have one. CI's sandbox is documented at *"few"* desks. The done-when is unsatisfiable as stated.

### 4e · The narrower finding under all of this

`queue-reading.ts:251` — the supervisor's own route to `isAgentFree`:

```ts
const stateOf = async (entry, world) => {
  if (!(await world.workerAlive(entry.worktree))) return 'none';
  return (await world.blocked(entry.worktree)) ? 'waiting' : 'running';
};
```

**It never calls `agentState`, never calls `taskState`, and never reads the shell's state word.** It answers `running` for any live worker that is not blocked — which is exactly what the plan wants for a free agent, and it already does it.

So `matchQueue`'s free-list filter, on the supervisor path, **already sees these three agents as `running`** and `isAgentFree` already returns true for them once `branch === ''`. `plot-dispatch.sh:1821` states the same expectation: *"`isAgentFree` already reports exactly that state as free (`rules/free.ts:64`: alive, and `branch === ""`)"*.

The plan's chain (§"The chain, every link read") routes step 6 through `rules/free.ts` as though the supervisor reads the shell's `finished`. **It does not** — the daemon reads `workerAlive`. The reported `idle=3 handed=0` therefore has a different cause than the plan's chain names, and the prior panel said the same thing from the other side: *"the honest defect is narrower than the plan's."*

That cause is worth measuring before any enum is touched. `queue.ts:283` `idle: free.slice(next)` counts agents that **were** free and got nothing — so `agents=3 handed=0 idle=3` is the reading of three agents **on the free list** with no slice passing `whyNotReady`. That is a queue-eligibility finding, not a state finding, and it would survive this entire plan.

**The board half of the complaint is real and separate.** `WORKING: none` is `isLiveState` over the *registry's* state, which comes from `bashLiveness` → the shell → `finished`. Two different readers, two different defects, one plan treating them as one chain.

---

## 5 · Is the change reversible, and is the blast radius bounded?

**Reversible: yes, by `git revert`.** Nothing here writes persisted state — `transitions/agent.ts:6` is explicit that an `AgentState` is derived every scan and *"Nothing anywhere writes an `AgentState`."* No migration, no stored field.

**Bounded: no.** The slice as written is one branch touching:

- 2 domain enums (`AgentStateSchema`, and `WorkerStateSchema` unnamed)
- 2 exhaustive `Record` maps
- 2 wire formats with hard length checks (4-field and 7-field)
- 2 built bundles (`plot-task.mjs`, `plot-agent-state.mjs`)
- 3 `switch` defaults that silently render blank
- 2 contradicting liveness predicates (`isLiveState` / `isLive`)
- 5 failing pinning assertions, one a named gate against this exact change
- 1 corpus test whose contract forbids adjusting either side
- 1 shell function inside the `--offline` per-branch loop
- the board's `WORKING` render, plus `attention.ts`

**And the domain's 100% coverage floor makes it larger, not smaller.** Every new arm needs a test, including `NEXT`'s and each `switch`'s.

The single-slice framing is what makes this unbounded rather than merely large. There is no intermediate state where half of it is coherent: the enum member, the two wire formats and the five assertions must land together or the build is red.

---

## Why reject rather than amend

I weighed amend. The amendment list would be: rename the state; replace the discriminator; add `NEXT` and `observeAgentState`; add `WorkerStateSchema`; name both wire formats; name the five pinning tests and argue each; name `isLiveState` and `isLive`; name the three `switch` defaults; rewrite the corpus done-when; and re-measure the supervisor's actual path.

**That is not an amendment. It is the difference between a plan and a different plan** — the prior moderation's own test, and it applied to a shorter list than this one.

Two findings settle it independently of length:

1. **`idle` cannot be the word.** It is taken, in the file being edited, and a test with a docstring refuses this exact move by name.
2. **Detachment cannot be the discriminator.** It is measurably false on two of the plan's own three desks, and the mechanism that makes it false — `reset_desk` — is in the loop the plan cites.

Both are premise-level. Neither survives a rewrite of the "What changes" section, because each invalidates a choice the rest of the plan is built on.

**What survives, and should be carried forward:**

- The root-exclusion analysis, for the third panel running. It is right: identical all-false readings carry two meanings.
- `taskState`'s split into an all-clear arm that asks a further question. The *shape* is sound; the question and the word are both wrong.
- The explicit `isAgentFree` change. The plan learned the first panel's lesson and stated the link. That discipline should carry to the eleven silent readers it missed.

**What the next plan should measure before proposing anything:**

`queue-reading.ts:251` does not read the shell. Measure why `handed=0` with three agents on the free list, because that path already reports them `running`. The board's `WORKING: none` is a second, genuinely shell-fed defect. **They are two findings, and one plan chaining them together is how both prior plans located the fix in the wrong place.**

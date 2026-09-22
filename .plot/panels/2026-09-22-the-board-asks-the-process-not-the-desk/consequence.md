# Consequence lens — the board asks the process, not the desk

Position: amend

## The finding in one sentence

The plan says *"no new state, no schema change, no wire field"* and concludes the blast radius is a display. It is not. The registry row's `state` feeds `liveAgentCount` and `freeAgentCount`, which are the two halves of **auto-dispatch's budget arithmetic** — and `autoDispatch` is `true` on this machine right now. Flipping three rows from `finished` to `running` **changes what the board starts**, and the plan's "Done when" list does not mention it.

## 1. Who reads the registry row's state

Traced across `packages/board/src`. Ten readers, in four groups.

**Display (what the plan accounts for):**

| reader | file | what changes for a between-slices agent |
|---|---|---|
| `workingAgentRows` | `app/lib/agent-rows/working-agents.ts:45` | filters `isLiveState` — agent now RENDERS in WORKING. **This is the plan's whole stated goal.** |
| `waitingAgentRows` | `working-agents.ts:85` | filters `isBrokenState` — `finished` and `running` are both non-broken. **No change.** |
| `agentStateStatus` | `rows.tsx:2297` | prints the word. `finished` → `running`. |
| badge tone | `rows.tsx:2479-2481` | `finished`→`success` becomes `running`. Cosmetic. |
| `DropAgentButton` gating | `rows.tsx:2519` | renders on `isBrokenState`; unchanged either way. |
| "not working" tally | `AgentList.tsx:552` | `!isLiveState` count drops by 3. |
| `fleetControls.working` | `fleet.ts:7525, 7642` | `isLiveState` count 0 → 3. Stepper label and supervisor badge both read it. |

All seven are honest improvements. `fleet.ts:7642`'s own comment demands this count equal what WORKING renders — today it is 0 while three agents live, so the plan **fixes** a stated invariant.

**Availability (the second question):**

`agentAvailability` (`tuple-row.ts:960`) → `isAgentFree` (`rules/free.ts:64`), whose first line is `if (reading.state !== 'running') return false`. The row's `free` chip is dark today for exactly this reason and lights after. Also correct.

## 2. Does anything WRITE based on this state — YES, and the plan never names it

**This is the answer to the lens's critical question, and it is the reason for `amend`.**

`server/auto-dispatch.ts` reads `LIVE_STATES` over the registry rows in three places and is the path that **starts workers**:

- `liveAgentCount` (`:123`) — `agents.filter(a => LIVE_STATES.has(a.state)).length`
- `liveAgentBranches` (`:140`) — the refusal message's names
- `pruneInFlight` (`:889`) — `LIVE_STATES.has(a.state) && a.branch` decides which in-flight marks are confirmed and retired
- `freeAgents` (`:220`) — `isFree(a, …)`, i.e. `isAgentFree`, which tests `state === 'running'`

And `freeAgentCount` **is** the fall-through budget at `planAutoDispatch` `:494`:

```ts
let budget = controls.parallelAgents - (liveCount + inFlight.size);
if (budget <= 0) { budget = freeAgentCount(agents, pulse); if (budget <= 0) return []; }
```

Measured on this estate, `.plot/state/fleet-controls.json` = `{"autoDispatch":true,"parallelAgents":5}`, three manifests all `branch: ""`:

```
TODAY  (finished): liveAgentCount=0  freeAgentCount=0  budget=5-(0+0)=5  → dispatch budget 5
AFTER  (running):  liveAgentCount=3  freeAgentCount=3  budget=5-(3+0)=2  → dispatch budget 2
```

**Two real, opposite effects, neither in the plan:**

1. **The cap tightens.** Three free agents stop being invisible to `liveAgentCount` and start occupying three of five slots. The board will start **fewer** new dispatches per pulse — 2 instead of 5. That is *correct* by `liveAgentCount`'s own docstring (*"a live agent ALWAYS occupies a slot"*, the fix for `a-landed-branch-still-holds-a-slot`, 2026-08-25) — the three agents genuinely hold three machines. But it is a behaviour change to a write path, and the plan's `## What this plan does NOT claim` asserts the opposite: *"It does not make the fleet dispatch more."* True, and incomplete — it makes it dispatch **differently**, and at the cap, **less**.

2. **The free fall-through opens.** Once at the cap, `budget = freeAgentCount` goes 0 → 3, so the board gains a path to hand slices to existing agents that is dead today. This is the *intended* fleet design (`free.ts`: *"a landed-branch agent is occupied and free at once"*) and is arguably the deeper bug being fixed — but it means **the change is not display-only**, and `handed=0` may stop being 0.

3. **`pruneInFlight` retires marks sooner.** A branch held by an agent that newly reads `running` is now seen as *the registry caught up — confirmed* and drops from the in-flight set. Only fires for agents holding a branch, so not the three measured here; still a write-adjacent behaviour change.

**`server/drop.ts:225` refuses on the same set.** `if (LIVE_STATES.has(state)) → cannot drop a ${state} worker`. A between-slices agent is droppable today and **becomes undroppable** after. That refusal is *right* — dropping a live agent's manifest is the `deleting-a-manifest-creates-an-unknown-row` defect — but it removes an operator action that works today, silently, and the plan does not mention Drop at all.

**The supervisor does NOT read it.** `server/supervisor.ts` and `entry/registryd-main.ts` build their own world: `workerAlive` is `recordedPid` + `isAlive` (`supervisor.ts:324`), never the registry row's `state` field. `supervision.ts:274` gates on `readings.workerAlive`. So **no reap, no correction, no `PLOT-BLOCKED` marker changes** — the supervisor's disk writes are untouched. The plan is right about this half; it just never checked the half that is affected.

## 3. Correction budget and worker bound — not affected

`rules/supervision.ts` reads `attempts` against `MAX_ATTEMPTS` (`:203`) and orders `workerAlive` first (`:274`), returning `leave`/`worker-alive` before any gate or budget arm. `boundRefusal` reads the same `readings`. None of it touches the registry row's `state`. **An agent that reads `running` forever is not thereby protected from reaping or correction** — the supervisor already decides from the pid, which is the very fact this plan proposes the row adopt. The two will now agree rather than disagree, which is a strict improvement.

## 4. `plot-fleetctl.sh --status` — a separate reader, unfixed

`plot-fleetctl.sh:450` calls `plot_worker_state "$wt"` **directly** and counts `[ "$st" = "running" ]` into `n_run` (`:485`, `agents_running=`). It never consults the board, the registry manifests, or any TypeScript. The plan changes one board consumer and leaves the shell script reading `finished` from the same helper.

**So `agents_running=0` stays 0 after this change.** I reproduced the shell's own answer:

```
free-719604d9 => finished   (pid 27820, alive)
free-fe7ff576 => finished   (pid 243,   alive)
free-c810e5bb => finished   (pid 6542,  alive)
```

The plan's `## What must not break` says *"The shell keeps its answer… This changes one consumer's reading, not the script"* — correct and deliberate. But the consequence is that **two readers of the same defect now disagree**: the board says `running`, `--status` says `finished`, and an operator comparing them sees a contradiction where today they at least agree on being wrong. The plan should name this as accepted and out of scope, or close it.

## 5. Is `finished` ever the CORRECT answer here?

**For the registry row specifically, no** — and I looked for one. `isBrokenState` excludes `finished` deliberately (*"the work reached review, and the PR carries it"*), which is a claim about a **dispatched** agent whose worker exited. A free agent between slices has no PR, reached no review, and carries nothing — so `finished` is not merely the wrong question, it is an untrue answer in its own vocabulary. `NOT_LIVE_STATES`'s stated common property — *"no process is working here now"* — is **false** of all three measured desks.

The one place `finished` must survive is the **exited** worker, and the plan's guard (`pid alive`) is precisely the discriminator that keeps it. I found no consumer that needs `finished` for a live pid.

**One caveat the plan understates:** `isLiveState` is a denylist, so `finished` is one of only seven words that can ever be filtered out of WORKING. Narrowing it by a runtime condition (`pid alive`) means the shell's word and the row's word stop being the same vocabulary — a reader of `registry.ts:16`'s docstring (*"the state comes from `plot-worker-state.sh`"*) will now be reading a statement that is true of seven states and refined for one. That docstring must change with the code.

## What I ask for

The premise is sound and the measurement reproduces exactly — three pids (243, 6542, 27820), all alive, all reading `finished`. `queue-reading.ts:251-252` is quoted correctly (the plan cites the path as `queue-reading.ts:249`; `isAgentFree` is asked at `rules/queue.ts:249`, and both exist — no defect, just two line numbers that read as one).

**Amend, on four points:**

1. **Name auto-dispatch as an affected consumer.** `liveAgentCount` 0→3 and `freeAgentCount` 0→3 change the dispatch budget from 5 to 2 at the cap and open the free fall-through. State whether this is intended. I believe it is — it restores `a-landed-branch-still-holds-a-slot`'s invariant — but it must be a claim, not a surprise.
2. **Delete or qualify *"It does not make the fleet dispatch more."*** It changes what the fleet dispatches. A reader takes that sentence as *no write path is touched*, and one is.
3. **Name Drop.** A between-slices agent becomes undroppable (`drop.ts:225`). Correct behaviour, removed operator affordance, unmentioned.
4. **Add a "Done when" that pins the write path**, beside the existing `no-free-agent=0` tick: assert `liveAgentCount` and `freeAgentCount` over three free agents before and after, and that auto-dispatch starts nothing it should not. The plan proves the queue is unaffected and never proves the *dispatcher* is — which is the one path that touches disk.

Optionally: say that `plot-fleetctl.sh --status` keeps reporting `agents_running=0` and why that is acceptable for this slice.

None of this contradicts the design. The reading is right, the discriminator is right, the shell staying put is right. What is missing is that the field being changed is load-bearing for a writer, and a plan whose Board-impact line says *"no wire field"* invites a reviewer to skip exactly the check that matters.

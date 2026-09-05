## Implementation brief — an-agent-is-started-by-a-command (slice: Starting an agent)

- **Plan (canonical):** `docs/plans/2026-09-05-a-process-is-started-by-its-own-command.md` on `main`
- **Design:** `docs/stories/the-master-agent-holds-the-fleet/DESIGN-process.md`, `DESIGN-agent.md`
- **Branch:** `feature/an-agent-is-started-by-a-command` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 1 of five, and it gates the other four. It was written fourth and moved to the front on 2026-09-05 by a measurement, not a preference — see *Why this leads*.

## The gap, measured

`/plot-dispatch a-process-is-started-by-its-own-command` reported `handed over feature/the-fleet-changes-hands → the registry` and `started=0`, which is correct under the hand-over model. The supervisor then ticked:

```
plot-registryd tick agents=0 left=0 reap=0 correct=0 person=0 defer=0 handed=0 queued=456 idle=0 cost=1185ms
agents registered: 0
```

The slice is queued, the registry is willing, and `.plot/agents/` is empty. **The chain is dispatch queues → registry matches → an agent takes it, and the last link has no starter.**

## Why this leads

Dispatching the rename first queued the plan's own first branch against `agents=0`. The plan's first slice could not be worked by the fleet the plan exists to build.

**It does not need the rename.** `/plot-fleet --start` is the door this slice is eventually invoked by, and *The fleet changes hands* builds that door. Nothing here waits on it: the starter is reachable as the script it is, and the flag is wiring added later.

## What this delivers

A command that brings agents into existence with **no slice assigned** — free, registered, waiting — defaulting to three, so the supervisor's next tick can hand each a queued slice with nobody touching a desk.

## The four things that are already there

Do not rebuild these.

**`isAgentFree` already expresses a branchless agent.** `rules/free.ts:64`:

```ts
if (reading.state !== 'running') return false;
return reading.branch === '' || reading.sliceHasMerged;
```

An agent with `branch: ''` and a live process is free. That is the state this command creates.

**`write_agent_manifest` already takes the branch as a parameter** (`plot-dispatch.sh:325`), so `""` is passable without touching its shape. It writes `pid` empty for the wrapper to stamp.

**`wait_for_work` already handles holding no branch** (`plot-worker-loop.sh:1142`), polls the agent's own manifest rather than running a scan, and its bound message already says *"the agent holds no branch"*.

**`AgentStartWrite` already exists** — kind `worker-start`, in `workflows/decision.ts:190`, carrying a branch and a worktree, with its command deliberately absent. Nothing has ever applied it.

## The three things that are not, and they are the work

**1. THE LOOP RUNS THE PROMPT BEFORE IT REACHES THE WAIT.** `plot-worker-loop.sh:1203` opens `while true; do ... run_bounded`, and the wait at line 1362 sits on the **hop** path, after a first prompt has finished. Measured 2026-09-05: no guard on `PLOT_BRANCH` exists anywhere before line 1203. So a branchless start today runs the worker prompt with `PLOT_BRANCH` empty rather than waiting to be handed work.

This is the slice's central change: **a loop started with no branch must enter the wait first, not the prompt.** The wait already exists and already says the right sentence; what is missing is reaching it.

**2. `start_worker` NEEDS A WORKTREE AND A FREE AGENT HAS NO BRANCH TO MAKE ONE FROM.** `plot-dispatch.sh:518` is `start_worker(branch, wt)`. A free agent still needs a desk to live in — the loop reads `${PLOT_WORKTREE:-$PWD}` throughout, and the transcript directory is derived from that path.

Decide where a branchless agent sits and say why in the code. The loop's own hop path already answers the shape of this: it **resets** an existing desk onto the next branch rather than creating one per slice, and `git worktree add` is the exception. A desk cut from the default branch is the obvious candidate — but note the standing rule that a worktree sitting on the default branch is one of `plot-reap.sh`'s five refusals, so whatever is chosen must not read as reapable.

**3. `worker-start` IS IN THE PERFORMER'S REFUSAL LIST.** `adapters/performer/perform-fs.ts:60` lists it in `BEYOND_THE_FILESYSTEM`, skipped rather than performed, so that a sandbox cannot start a real agent. That is correct and must stay correct. There is exactly **one** performer in the repo today.

So the production path is not "unskip it" — it is a performer that may reach the process table, with the sandbox one unchanged. Keep the layering rule: the domain decides, an adapter performs, and only an adapter shells out.

## The supervisor scales up

`--start` starts what the queue needs, up to the count. An empty queue brings the supervisor up and no agents — three Claude sessions idling against no work is a cost with nothing on the other side.

**When `queued > running` the tick starts agents up to the cap.** The daemon already ticks every 60 s and already derives the queue. Without this, a dispatch an hour after start queues a slice with nobody to take it — which is exactly the failure above.

**The tick stays stateless.** `supervise` names writes and makes none; a `kill -9` mid-tick loses nothing, because the count is re-derived from the queue on the next pass rather than remembered. Measured: a daemon killed two seconds into a 3.4 s tick was followed by a whole tick reaching the identical decision, with no state file written.

**The shortfall is dropped, not remembered.** A run that starts two of three says which and why — *"started 2 of 3 — the machine is at its bound (load 14.2, 5 workers already running)"* — and the operator runs it again. A stored target would be the daemon's first piece of state.

## Numbers

**Default 3.** Small enough to be wrong about cheaply, large enough to prove the hand-over matches more than one agent to more than one slice.

**`--max` is NOT this number.** `registryd --max` bounds how many agents one tick may act on — a rate limit on decisions, default 0 for no bound. A fleet size is a third quantity: how many workers this machine runs at once.

**An idle agent dies on the existing bound.** `Worker bound: 28800` caps a worker at eight hours and an agent handed nothing lives under the same number. No idle-specific bound — a second number needs its own answer to *how long is too long to wait*, and there is no measurement for that yet.

**The machine has the last word.** `DESIGN-machine.md` measures *"7 workers died `exit 124`"* and *"five workers ran fine at load 10"*. The count is a request; a machine at its bound answers with fewer and says so.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

A test that a branchless loop enters the wait rather than the prompt is the one that would have caught finding 1. `workerloop.test.mjs` already partitions the loop's four endings and is where it belongs.

## Done when

- a command brings agents into existence with no slice assigned — free, registered, waiting — defaulting to three
- a branchless loop **waits** rather than running the prompt on an empty `PLOT_BRANCH`
- `isAgentFree` reports them free with no change to `rules/free.ts`
- the supervisor's next tick hands each a queued slice without a person touching a desk
- a tick starts agents when `queued > running`, up to the cap, and writes nothing between ticks
- a shortfall is reported with its reason and not remembered
- `perform-fs.ts` still refuses `worker-start`
- the gates above pass

## Do not

- **Do not remove `worker-start` from `BEYOND_THE_FILESYSTEM`.** The sandbox performer must stay unable to start a real agent.
- **Do not relax `isAgentFree`'s `state !== 'running'` guard.** Its docstring gives the reason: a manifest field would need clearing by whoever hands over the work, and an agent that crashed between finishing and writing it would read free without being so.
- **Do not give the daemon a stored target.** Statelessness is measured, not assumed.
- **Do not merge `attempts` and `relaunches`.** `attempts` is the supervisor's counter and the only one a budget reads; `relaunches` is a person's record.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
- **Do not rename anything.** The rename is *The fleet changes hands*, and touching it here creates the conflict the single-slice argument exists to avoid.

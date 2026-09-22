# Premise lens — the board asks the process, not the desk

**Subject:** `docs/plans/2026-09-22-the-board-asks-the-process-not-the-desk.md`
**Lens:** the premise — *the queue path already works, and only the board display is broken.*

Position: amend

**The premise is TRUE and the plan's headline evidence for it is WRONG.** I tried to break the claim and could not. But `no-free-agent=0` does not mean what the plan says it means — it cannot, structurally — and the plan builds its opening paragraph, its section heading and its done-when on it. The conclusion survives because two *other* readings prove it, one of which the plan already prints and does not use.

## 1 · `no-free-agent=0` is not what the plan says it is

**It is unreachable this tick, not zero-because-the-list-was-full.**

I re-ran the tick:

```
plot-registryd tick agents=3 left=3 reap=0 correct=0 person=0 defer=0 handed=0
held=266 idle=3 already-merged=0 merge-unknown=0 no-brief=1 not-claimable=265
no-free-agent=0 unclaimed=14 cost=9914ms
```

`rules/queue.ts:249` — the counter is incremented **inside the slice loop, after the readiness gate**:

```ts
for (const slice of readings.slices) {
  const hold = whyNotReady(slice);
  if (hold !== null) { held.push({ branch: slice.branch, hold }); continue; }   // ← 266 of 266 exit HERE
  if (next >= free.length) { held.push({ branch: slice.branch, hold: 'no-free-agent' }); continue; }
  …
}
```

`not-claimable=265` + `no-brief=1` = **266 = `held`**. Every slice took the first `continue`. The `next >= free.length` test **never executed**. So `no-free-agent=0` is a count of a line that did not run.

The plan's sentence — *"`isAgentFree` is finding all three agents on every tick"* — is a true statement that this counter **cannot** support. On a tick where the ready list is empty, `no-free-agent` reads 0 whether the free list holds three agents or none.

**I proved that directly.** Running `matchQueue` against the three live agents with their `state` forced to `finished` (i.e. `isAgentFree` false), one ready slice:

```
ifFinished -> handed=0, held=[{branch:'bug/x', hold:'no-free-agent'}], idle=0
```

**`no-free-agent` counts UP when agents are not free.** It reads 0 today because nothing was ready — the plan has the causal direction of its own headline number backwards.

### What DOES prove the premise, and the plan already prints it

**`idle=3`.** `entry/registryd.ts:324` emits `idle=${queue.idle.length}`, and `queue.idle` is `free.slice(next).map(a => a.session)` — sliced straight off the free list, computed by `isAgentFree`, with **no slice-level gating in front of it**. `idle=3` against `agents=3` says all three passed `isAgentFree`. That is the measurement the plan needs, it is in the tick line the plan quotes, and the plan does not cite it.

**Amendment 1:** replace `no-free-agent=0` with `idle=3` as the plan's evidence, everywhere — the quoted block's emphasis, the *"The measurement that reframes it"* argument, and the done-when. `idle=3` is the honest reading; `no-free-agent=0` is a tautology on an empty ready-list.

**Amendment 2:** the done-when *"`no-free-agent=0` before and after, proved by a tick"* is **not a regression test**. It will read 0 after the change for the same reason it reads 0 now, and would also read 0 if the change broke `isAgentFree` outright. Make it `idle=3 agents=3`, which discriminates.

## 2 · `stateOf` really never consults the shell — confirmed, and this is where the last panel went wrong

Traced to the implementation. `queue-reading.ts:249`:

```ts
const stateOf = async (entry, world) => {
  if (!(await world.workerAlive(entry.worktree))) return 'none';
  return (await world.blocked(entry.worktree)) ? 'waiting' : 'running';
};
```

`world.workerAlive` → `supervisor.ts:324`: `options.recordedPid(worktree)`, then `options.isAlive(pid)`. **`.plot-worker.pid` plus `kill -0`. No shell, no desk, no `taskState`.**

Import check on `queue-reading.ts`: it imports `eligible`, `queue`, `landed`, `PlanRecord`, `AgentEntry`. **It imports no `agent-state`, no `taskState`, no `plot-worker-state.sh` resolver.** There is no other path by which the shell's `finished` reaches `isAgentFree` — the `branch` field comes from the manifest (`entry.branch`), not from a desk reading.

I measured the three live desks directly:

| desk | manifest pid | `kill -0` | shell `plot_worker_state` | manifest `branch` |
|---|---|---|---|---|
| free-fe7ff576 | 243 | **ALIVE** | `finished` | `""` |
| free-c810e5bb | 6542 | **ALIVE** | `finished` | `""` |
| free-719604d9 | 27820 | **ALIVE** | `finished` | `""` |

So `stateOf` → `running`, `branch === ''` → **`isAgentFree` true on all three**, while the shell says `finished` on all three. **Two readings of one fleet, disagreeing, exactly as the plan describes.** The defect claim is confirmed live.

**This is the finding that settles rubric 4.** The clear-desk panel's measurement juror verified a seven-link chain ending:

> | 6 | `isAgentFree` opens on `!== 'running'` | `free.ts:64-67` verbatim |
> | 7 | `queue.ts:249` filters with it | verbatim |
>
> …`taskState` returns `finished`, **`isAgentFree` rejects them**

Links 6 and 7 are correct about the *rule*. The chain is wrong about **what reading is fed to it** — it assumed the queue's `state` comes from `agentState`/`taskState` (links 4–5), and it does not. Nobody on that panel opened `queue-reading.ts`. Four jurors verified a chain through a file none of them read, and the moderation called it *"verified whole, the first time across three attempts."*

**The plan's reframing is sound, and it is a genuine correction of a panel finding rather than a discard of one.** Twelve jurors endorsed a causal chain whose sixth and seventh links describe a code path that is not the one under discussion.

## 3 · The decisive test — would the three agents actually be handed work?

**There is no claimable-and-briefed slice on the estate today.** `no-brief=1` is the closest: one slice is `claimable` and was held *only* for a missing brief. Nothing reached the free-list test.

So the estate cannot answer this by observation, and I constructed the control instead — the three live agents as the tick reads them, against `matchQueue`:

| input | result |
|---|---|
| 3 live agents, `isAgentFree` | `[true, true, true]` |
| **+ 1 ready slice** (claimable, briefed, not landed) | **`handed=1`, `held=[]`, `idle=2`** |
| + 4 ready slices, 3 free | `handed=3`, `no-free-agent=1` |
| today's shape (5 non-claimable) | `handed=0`, `not-claimable=5`, `idle=3` |
| **same 3 agents forced to `finished`** + 1 ready slice | **`handed=0`, `no-free-agent=1`** |

**Row 2 is the positive control the plan needs and does not have: a ready slice IS handed over, today, to these agents.** The queue path works.

**What the absence means, and the plan says it honestly.** `handed=0` has nothing to do with the agents. The plan's *"What this plan does NOT claim"* section states this outright — `handed=0` is `not-claimable=265` and `no-brief=1` — and that section is the most accurate part of the document. A reader expecting throughput from this change gets none.

**Amendment 3:** put row 2 in the plan. It is one `matchQueue` call, it is the only evidence that actually tests the premise, and the plan currently asserts the premise from a counter that cannot test it.

## 4 · One unremarked arm, and it does not break the plan

`plot-worker-state.sh:859`, *above* the `finished` route:

```sh
if [ ! -f "$wt/.plot-worker.wrapper.pid" ]; then printf 'running\t%s\t' "$pid"; return; fi
```

A desk with a live pid and **no** `.plot-worker.wrapper.pid` already reads `running` from the shell. All three live desks **have** the file, so all three reach the desk route — the plan's population is correctly identified. But the plan's change ("where the shell answers `finished` and the pid is alive, read `running`") must not disturb this arm, which reaches the same answer by a different route. Worth one line in the slice; not a defect.

## 5 · What would falsify this plan

1. **A live desk where `stateOf` returns something other than `running`.** A `PLOT-BLOCKED` marker makes it `waiting` — still in `LIVE_STATES`, so the row renders either way. Only a dead pid falsifies, and that is `finished` correctly.
2. **A path from the shell into `isAgentFree`.** Searched: none exists. If `queue-reading.ts` ever imported the registry's `bashLiveness`, the premise collapses and the three previous plans become right.
3. **A desk that is `finished`-by-shell, pid-alive, and genuinely NOT free** — i.e. holding unlanded work. The shell tests `stalled` and `waiting` before `finished`, so this is unreachable by construction. The plan states this guard and it holds.
4. **`no-free-agent` rising above 0 on a tick with three idle agents** would prove the free list empty. It cannot: I showed the counter moves in the opposite direction.
5. **The real risk the plan does not name:** the change makes the board row read `running` for a desk whose pid is alive. If a `stalled` desk's pid is alive — a wrapper alive with unpushed work — the shell answers `stalled`, not `finished`, so the change does not reach it. **Falsified only if `plot_worker_task_state` can answer `finished` over a dirty tree.** I did not measure that path; the reaper depends on it and the plan's own *"What must not break"* asserts it. A unit test over a dirty desk would close it, and the slice should name one.

## Position

The premise holds. Every check I ran to break it confirmed it instead, and I found that the panel finding it reverses was itself verified through an unread file.

But a plan whose opening sentence, whose section heading, and whose regression test all rest on a counter that **structurally cannot measure what it is cited for** is not ready to proceed unchanged — the more so for a plan whose whole purpose is correcting three predecessors that measured the wrong thing. The right reading is already in the tick line it quotes.

Three amendments, all evidentiary, none touching the design:

1. Cite `idle=3`, not `no-free-agent=0`, as the premise's evidence.
2. Replace the `no-free-agent=0` done-when with `idle=3 agents=3` — the current one passes whether or not the change works.
3. Add the `matchQueue` positive control (one ready slice → `handed=1`) as the proof the queue path works.

Position: amend

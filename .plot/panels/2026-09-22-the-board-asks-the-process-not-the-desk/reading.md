# Reading lens — the board asks the process, not the desk

Position: amend

The premise reproduces and the layer is right. Three claims in the plan's own "What must not break" section are false as written, and one of them — the arm order — is the load-bearing safety argument. None is fatal; each is a correction the plan can absorb, and one of them makes the fix *smaller* than proposed.

## 1. Where exactly does this change go?

**One site, and the plan does not name it.** The plan says "the registry row's state" and cites `registry.ts:16`, `55`, `328` — a doc comment, `KNOWN_STATES`, and a `const` string. None is the site.

The shell's answer becomes the row's state in **exactly one place**:

- `packages/board/src/server/registry.ts:865` — `bashLiveness`, which runs `plot_worker_state "$wt" '' | cut -f1` and returns the raw words.
- `packages/board/src/server/registry.ts:811-814` — `refreshStates`, which assigns `entry.state = KNOWN_STATES.has(answer) ? answer : 'unknown'`.

`refreshStates` is the assignment; `bashLiveness` is the derivation. `KNOWN_STATES` (line 55) is a membership filter derived from `AgentStateSchema.options` and decides nothing about which state is right.

**But there is a second consumer of the same function, and the plan never mentions it.** `drop.ts:151` `classifyState` calls the **same injected `LivenessResolver`** for one entry:

```ts
const [answer] = await liveness([entry.worktree]);
if (KNOWN_STATES.has(answer)) return answer as AgentEntry['state'];
```

So there are **two readers and one resolver**. That is a finding in the plan's favour on siting, and against it on blast radius — see §3.

## 2. Is `finished` + live pid unambiguous?

**No. Measured, there are five ways in, and the plan describes one.** I probed a synthetic desk (live wrapper pid, wrapper file present, `PLOT_AGENT_GRACE_SECONDS=0`) against the real `plot_worker_state`:

| desk | PR fact | shell answers |
|---|---|---|
| A clean | `''` | `finished` |
| B dirty | `''` | `stalled` |
| **C dirty** | **`pr`** | **`finished`** |
| **D blocked** | **`pr`** | **`finished`** |
| E blocked | `''` | `waiting` |

Rows C and D are the plan's blind spot, and they exist because `taskState`'s **first** arm is `if (readings.hasPr) return 'finished'` — it outranks `blocked` and `dirty` both.

**What saves the plan is a fact it never states: the registry passes an empty PR fact.** `registry.ts:870` hardcodes `plot_worker_state "$wt" ''`. So on the registry's path C and D are unreachable today, and B and E do protect the cases the plan claims. The conclusion is right; the stated reason is wrong, and the guard is an undocumented argument literal three lines from the change rather than the arm order.

**Is a dispatched worker in the `finished` + live-pid set? Yes — and all three of the plan's own exhibits are that case.** Measured on this estate right now, the three live desks the plan calls "free agents between slices":

```
finished pid=243   alive=YES  .worktrees/free-fe7ff576   (detached, no envelope)
finished pid=27820 alive=YES  .worktrees/free-719604d9   bug/the-status-asks-the-process-table
finished pid=6542  alive=YES  .worktrees/free-c810e5bb   feature/the-call-asks-only-for-the-delta
```

Two of three sit on **named dispatched branches**, carrying `.plot-worker.envelope.json` and monitor journals. Both branches' PRs are **MERGED** (#960, #959). Their manifests say `branch: ''` because `plot-worker-loop.sh` clears the field on slice completion — the desk still holds the finished checkout.

**Is calling them `running` correct?** For the row's question — *is this agent alive and working here* — yes: the wrapper is alive and will take the next slice. This is the same population `liveAgentCount` already calls a slot-holder by design ("a live agent ALWAYS occupies a slot, even if its branch has already merged", `auto-dispatch.ts:110`). So the plan's reading agrees with a rule already settled elsewhere. **That agreement is the strongest argument in the plan and it is not made.**

## 3. Does the change break the reaper or dispatch?

**The script is genuinely unchanged — that half verifies.** `plot-reap.sh` sources `plot-worker-state.sh` directly and never reads the board's registry; `plot-dispatch.sh` and `plot-fleet-scan.sh` likewise. No TypeScript state flows back to them.

**But "the registry's row state feeds back into anything they read" is false, and the plan asserts the opposite twice.** Two in-process consumers read `entry.state` through `LIVE_STATES`:

- **`auto-dispatch.ts:123`** — `liveAgentCount` counts `LIVE_STATES` members as **occupied concurrency slots**. Three desks moving `finished → running` **consumes three slots** that are free today.
- **`drop.ts:225`** — refuses a Drop on `LIVE_STATES.has(state)` with *"cannot drop a running worker"*. Three desks currently droppable become **undroppable**.

Both follow automatically from putting the fix in `bashLiveness`, because `classifyState` shares the resolver.

The plan's table says *"no enum change, so no consumer must decide anything new"*. True of the enum; false of the values. `tsc` names nothing here precisely because the type is unchanged — which is why these two are the findings a compiler cannot hand you.

**Neither is necessarily wrong.** `liveAgentCount`'s own docstring argues a live agent should count. Drop refusing a live wrapper is arguably a fix. But they are behaviour changes to the dispatcher's budget and to an operator action, and the plan's Done-when list contains nothing that would notice either.

**One further interaction the plan misses:** `dropSettledWorkers` (`registry.ts:947`) skips cleanliness checks for `state === 'running'`. These three desks are clean and currently *candidates for dropping from the listing* — the only reason they render at all is that the default cleanliness resolver is a no-op. Under `fleet.ts`'s `bashCleanliness` the flip from `finished` to `running` is what keeps them listed. That is the plan's goal reached by a second mechanism it never names.

## 4. What about `stalled` and `waiting`?

**The claim is false as stated and true in effect.** Plan line 94: *"The shell tests `stalled` and `waiting` before `finished`."* It does not. `taskState` (`packages/domain/src/rules/task.ts`) is:

```ts
if (readings.hasPr) return 'finished';   // outranks both
if (readings.blocked) return 'waiting';
if (readings.dirty) return 'stalled';
if (readings.unpushed === true) return 'stalled';
return 'finished';
```

`finished` is tested **first**, not last. `waiting` outranks `stalled`, which is the only ordering claim in the plan that holds.

The outcome the plan wants survives only because `hasPr` is `false` on the registry's path. **Amend the sentence to name the real guard** — the empty PR argument at `registry.ts:870` — and add a Done-when pinning it, because that literal is now load-bearing and nothing says so. If a future slice gives the registry a PR fact (a plausible enrichment), rows C and D open and a blocked desk with a merged PR silently reads `running`.

## 5. Is there a simpler or more correct site?

**`bashLiveness`, and I would choose it — but with the discriminator taken from the shell rather than recomputed.**

Ruled out:
- **`LIVE_STATES`** — adding `finished` would move every exited-and-clean desk into WORKING, including the 9 `ended` and 5 `failed` desks here. Catastrophically wide.
- **The row builder** (`working-agents.ts`) — fixes only the section and leaves `entry.state` lying to `liveAgentCount` and Drop. Narrower blast radius, but it makes the registry's one liveness answer disagree with itself, which is what this estate's whole `plot-pr-merged.sh` tradition exists to prevent.
- **The shell** — forbidden by the plan's own constraint and rightly: the reaper depends on `finished` meaning *desk is clear*, and the corpus pair (`agent-state.corpus.test.ts`) compares rule against shell and would stop the branch.
- **`refreshStates`** — it has the entry (and thus the manifest pid) but not the wrapper-file evidence. Workable, but it would re-derive liveness in TypeScript, adding a second definition of *is this worker alive* beside the shell's.

**`bashLiveness` is right because the answer can be taken from the shell in the same pass rather than recomputed.** The program already loops the worktrees; `plot_worker_state` prints `state\tpid\tcode` and the current code throws away columns 2 and 3 with `cut -f1`. Take all three, and the row is `answers[i].state === 'finished' && pid alive` — where the pid is **the shell's own**, already staleness-checked by `plot_pid_is_current`. That matters: the manifest pid is documented as a display fact (`registry.ts:181`), and `plot_worker_state` has a fallback chain the registry must not reimplement.

**A sharper discriminator is available and I would prefer it.** The three live desks all carry `.plot-worker.wrapper.pid` with **no `.plot-worker.exit`** — the wrapper is between slices, not gone. The shell already distinguishes this: `finished` from the *live-wrapper* branch (line 871, no exit file) versus `finished` from the *exit-0* branch (line 894). Only the first is the plan's subject; the second is a genuinely exited worker that must keep reading `finished`. The plan's `pid alive` test happens to separate them, but a `code` column that is empty separates them *by construction* and reads directly off the answer the shell already prints.

## What I would require before proceeding

1. Correct line 94 — `hasPr` is tested first; name `registry.ts:870`'s empty PR argument as the actual guard, and pin it with a test.
2. Name the site: `bashLiveness` at `registry.ts:865`, not lines 16/55/328.
3. Add `liveAgentCount` and `drop.ts` to "What must not break", with a decision on each — three slots consumed, three desks undroppable. Both are defensible; neither is currently acknowledged.
4. State that the exhibits are dispatched workers with merged PRs, not idle free agents, and lean on `auto-dispatch.ts:110`, which already settled that a live agent on a merged branch holds a slot.
5. Take the pid from the shell's own output, and prefer the empty `code` column as the discriminator over a recomputed `kill -0`.

The defect is real, the layer is right, and the fix is one expression. The plan has simply not yet read the two consumers that sit behind the field it is changing.

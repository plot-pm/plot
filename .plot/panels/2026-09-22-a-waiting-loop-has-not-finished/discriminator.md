# Discriminator lens — a waiting loop has not finished

**Subject:** `docs/plans/2026-09-22-a-waiting-loop-has-not-finished.md`
**Lens:** the proposed discriminator — *a live recorded pid plus no `.plot-worker.exit` means the loop has not exited, so `plot_worker_task_state` must not be asked.*

**Verdict:** reject — stated formally at the end of this file.

## The finding in one line

**The proposed discriminator is not a discriminator.** `.plot-worker.exit` is written by the WRAPPER and `.plot-worker.pid` names the AGENT — two different processes — so "live pid AND no exit file" is the normal state of a healthy dispatched agent mid-slice, and the plan's own stated guard against that case is unreachable in the code it proposes to change.

## 1 · Does the stated problem exist? YES — reproduced on this estate

Three desks measured, `PLOT_AGENT_GRACE_SECONDS` untouched:

```
free-719604d9  ->  finished   27820   (alive 01:08:29, no exit file)
free-fe7ff576  ->  finished   243     (alive 01:35:41, no exit file)
free-c810e5bb  ->  running    6542    (alive 49:55)
```

And the display consequence is real. `registry.ts:957` (the plan cites `registry.ts:826`/`drop.ts`; the function is `dropSettledWorkers` at `registry.ts:947`) is:

```ts
if (e.state === 'running') continue;   // Live session — keep.
if (e.worktree === '') continue;
```

So `finished` + clean desk → dropped. **The plan's narrowing of the predecessor's claim — display, not assignment — is correct and I verified the correction**: both `workerAlive` implementations read `.plot-worker.pid` and call `isAlive`, never the shell. The rewrite fixed the predecessor's causal error honestly.

**That is the whole of what survives.**

## 2 · When is `.plot-worker.exit` written, and by what?

The plan asserts it is a fact about the loop. **It is not.** `plot-dispatch.sh:1416-1418`, the full wrapper body:

```sh
nohup sh -c 'printf "%s" "$$" > "$PLOT_WRAPPER_PID_FILE"; …monitors…;
             ( '"$cmd"' ) & agent=$!;
             printf "%s" "$agent" > "$PLOT_PID_FILE";
             …awk manifest stamp…;
             wait "$agent"; rc=$?; printf "%s" "$rc" > "$PLOT_EXIT_FILE"'
```

Three facts settle the lens:

1. **`.plot-worker.pid` names the AGENT subshell, not the wrapper.** `plot-dispatch.sh:1178` states it outright: *"TWO PIDS, TWO NAMES. `.plot-worker.pid` must name the AGENT."*
2. **`.plot-worker.exit` is written by the WRAPPER**, after `wait "$agent"` returns — `plot-dispatch.sh:1187`: *"the wrapper is what writes `.plot-worker.exit` when the agent exits."*
3. **`plot-dispatch.sh:1074` removes it at every launch**: `rm -f "$wt/.plot-worker.exit"`.

**So for the entire life of every healthy dispatched agent, the recorded pid is alive and no exit file exists.** That is not the waiting-agent population. That is *every agent that is working*. The plan's discriminator selects the union of the two and cannot tell them apart, which is what a discriminator is for.

The plan does quote the code's own sentence — `plot-worker-state.sh:872`, *"No exit file exists: the wrapper has not exited"* — and reads it as licence. That sentence is an **explanation of why the desk must decide**, not a test the code performs. The plan promotes a comment to a predicate.

## 3 · The window, and the answers at each edge

| the case | what the plan's arm answers | correct? |
|---|---|---|
| dispatched agent mid-slice, `claude` running | `running` (via the descendant arm, reached first) | unchanged, fine |
| dispatched agent whose `claude` has gone, wrapper still in `wait` | **`running`** | **WRONG — this is the orphan the estate measured** |
| agent exited, wrapper between `wait` returning and the `printf` | **`running`** | wrong, and it is a real window: a whole `printf` + fork-free write, plus any signal delivery in between |
| agent SIGKILLed — wrapper survives, writes the code | `finished`/`failed` after the write; `running` before it | the transient is the same window |
| **wrapper SIGKILLed** — agent orphaned to init, or agent killed and wrapper dead | pid gone → falls to the dead path → `ended`. But an agent reparented to init with the wrapper dead keeps a LIVE recorded pid and can never gain an exit file, so it reads **`running` forever** | **WRONG, and permanently** |
| `git worktree add` with no worker at all | `none` — verified by fixture; the pid-file arm returns early | unchanged |
| hand-made desk, live pid, no `.plot-worker.wrapper.pid` | `running` — already, via the wrapper gate at `:859` | unchanged |

**The mid-slice question the rubric asks has a worse answer than "unchanged".** The arm as written — *live pid + no exit file → running, before the descendant question is asked* — does not merely leave a working agent alone. It **removes the descendant question entirely for the whole dispatched population**, because the dispatched population never has an exit file while its pid is alive. `plot_worker_agent_alive` becomes dead code on the live path.

## 4 · What would break: it reverts commit `64787cd4b` in everything but name

`64787cd4b`, *"read whether an AGENT is alive, not merely its wrapper"*:

> Measured 2026-09-11: **four agents ended mid-slice, none failed a build, none wrote a marker, and every one reported `running`. Three left 8 commits and 9 uncommitted files on their desks** — one step from done, and all three would have been reaped as abandoned.

Those four desks had live recorded pids and no exit files. **The plan's arm restores `running` for every one of them.** The `stalled` reading that rescues 8 commits and 9 uncommitted files stops being reachable on a live wrapper — `stalled` is `plot_worker_task_state`'s answer, and the plan forbids asking it.

The same commit adds `PLOT-BLOCKED` → `waiting`. **A blocked agent on a live wrapper also stops being reachable**, which is ironic given the plan is named for waiting.

## 5 · The plan's own guard does not hold, and I measured it

The plan promises:

> **A dispatched agent with no `claude` child and an EXIT RECORD still reads `finished`.** … The new arm requires the absence of an exit record, so it cannot fire there.

Fixture, `PLOT_AGENT_GRACE_SECONDS=0`, live pid + wrapper file + `.plot-worker.exit` holding `0`:

```
B. live pid + wrapper + exit=0  ->  finished   57510
   readings: 1  1  orphaned  0  0  0
```

`finished` here is reached through the **orphaned** arm inside the live block, **not** through the exit arms at `:888` — those sit after the `kill -0` block and are unreachable while the pid answers. So the guarded case is not the case the plan's arm sits in front of. **The plan protects a path the code does not take, and the path it does take is the one it breaks.**

## 6 · The nearer mechanism the plan ignored — and it is the same omission the predecessor was rejected for

The predecessor's fatal blind spot was never naming `rules/free.ts`. **This rewrite never names `PidLiveness` or the `orphaned` reading**, and that is the mechanism that already exists for exactly this question.

`plot-worker-state.sh:1024` already emits a fourth liveness word:

```
liveness=orphaned    # the pid exists and our worker is no longer inside it
```

`rules/agent-state.ts:140` already routes it, deliberately and with a measurement in the docstring:

```ts
if (readings.liveness === 'orphaned') return taskState(readings.task);
```

> *"It routes to `taskState` rather than to `ended` for the reason the measurement gives — **three of four such desks held finished work**, and `ended` would have said the run was over when the WORK was one push from done."*

**The estate has already litigated this exact arm and decided it the other way, on four measured desks.** The plan proposes to overturn a documented measurement without citing it, contradicting it, or knowing it exists. The corpus fixture above confirms the shell and the rule agree today.

That also breaks the plan's own corpus claim. The plan says its change makes the pair pass because *"both sides move to `running` together, in one slice."* They cannot: the plan changes only `plot_worker_state`, and `plot_worker_readings` — the OTHER shell function, which is what feeds `readingsFrom` and the rule — has its own gathering at `:1005-1030`, written that way on purpose (*"A second gathering that drifted would make the corpus test compare this file against itself"*). Moving both sides also means editing `plot_worker_readings`, `PidLiveness`, `LIVENESS_WORDS` in `entry/agent-state.ts`, and `agentState` — four sites in a slice the plan describes as one branch, and **the third of those is a wire-format change that `asLiveness` throws on for any un-rebuilt bundle.**

## 7 · What would actually discriminate

The plan's own paragraph names it and then walks past it:

> `plot-worker-state.sh:848`'s `.plot-worker.wrapper.pid` is the estate's precedent for a launch-time fact of exactly this kind.

Right precedent, wrong conclusion drawn. The wrapper file works **because the wrapper writes it about itself at launch** — *"the process that knows a pid is the one that writes it."* The exit file is the mirror image: written by a different process, about a different process, at teardown, and absent for the entire healthy lifetime. It is the weakest fact in the desk, not the strongest.

A real discriminator must separate **"no agent has ever run under this pid"** from **"an agent ran and is gone."** The exit file cannot: it is absent in both. Candidates the rewrite should have weighed and did not:

- **A free agent's launch leaves a mark a dispatched one does not.** `--start` cuts a detached desk with no branch and no brief; `plot-dispatch.sh` writes a brief. A free desk that has never been handed a slice is distinguishable at launch, by the launcher, which is the only party that knows.
- **`.plot-worker.envelope.json` and `.plot-worker.ending.json`** (`plot-worker-loop.sh:973`, `:1098`) are per-branch and per-ending records the loop already writes, with **absence deliberately load-bearing**. A desk that has completed zero slices has neither. Neither is named in the plan.
- **The `waiting` state already exists** and is what the plan's title describes. The plan spends a section arguing against a ninth state, having skipped the one that is already there.

## The rubric, answered

1. **Does the problem exist?** Yes, reproduced — two of three live desks read `finished`, and `dropSettledWorkers` drops them. The display-vs-assignment correction is right.
2. **Is the change the smallest?** No. It is smaller than the problem in scope and far larger in blast radius: it deletes the descendant reading from the entire live path to fix a display bug.
3. **What could I not verify?** The claim *"the estate already distinguishes exited from never exited: `.plot-worker.exit` is written by the wrapper when the child returns."* The first half is false — **refuted**, not merely unverified. The second half is true and is precisely why the first is false.
4. **What breaks?** `stalled` and `waiting` become unreachable on a live wrapper, reverting `64787cd4b` and re-exposing the 8-commit/9-file loss it was written to stop; an agent orphaned by a dead wrapper reads `running` permanently; the corpus pair breaks unless three further sites move, one of them a wire format.
5. **Nearer mechanism?** `PidLiveness`'s `orphaned`, already emitted by the shell and already routed by the rule — with a four-desk measurement recording the opposite decision. Unnamed in the plan.

## Position

Position: reject

**The rewrite corrected the predecessor's causal error and then repeated its structural one**: it named a discriminator without reading what already answers the question, and the thing it named is a fact about a different process at a different time. This is not amendable by adding a condition, because the condition it would need — *has an agent ever run here* — is a different measurement, taken by a different party, at launch rather than at teardown. That is a different plan.

**What to keep for the third attempt:** the display-not-assignment narrowing (verified), the root-exclusion analysis (endorsed twice now), and the note that `WORKING`'s live-state filter is out of scope. **What it must start from:** `orphaned` exists, `agentState` already decides it, and the decision is backed by a measurement of four desks that the plan must either refute with its own or accept.

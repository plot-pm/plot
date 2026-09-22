# Causal chain — a waiting loop has not finished

**Subject:** `docs/plans/2026-09-22-a-waiting-loop-has-not-finished.md`
**Lens:** causal chain — verify every link, in the code, including the negative claim.

Position: amend

## Summary

**The defect is real and I reproduced it twice on the live estate.** The asserted chain holds at every link I could test: `registry.ts:826` → `defaultLiveness` → `bashLiveness` → `plot-worker-state.sh` → `dropSettledWorkers` is wired exactly as written, and the plan's negative claim about both `workerAlive` implementations is **confirmed**. This rewrite has fixed the predecessor's wrong causal story.

**But the plan locates the fix one layer too low, and it names the wrong discriminator.** The estate already computes the exact fact the plan wants to introduce, under a name the plan never mentions: `liveness=orphaned`. The plan proposes adding an arm keyed on `.plot-worker.exit`, in a place where that file is **always absent for both the population it targets and the population it must not touch** — so the discriminator it proposes cannot discriminate. The correct arm is one line, in a file the plan does not name.

That is an amend rather than a reject: the diagnosis, the location of the symptom, and the "do not touch `workerAlive`/`dropSettledWorkers`" guards are all correct and independently verified. What must change is the mechanism, and it gets *smaller*, not bigger.

## 1 · Does the stated problem exist? — YES, reproduced

Measured on the live estate, 2026-09-22, under `bash` (zsh mangles the `PLOT-BLOCKED*` glob):

```
.worktrees/free-719604d9   state=finished   agent_alive rc=1   log: "Waiting to be handed work"
.worktrees/free-fe7ff576   state=finished   agent_alive rc=1   log: "Waiting to be handed work"
.worktrees/free-c810e5bb   state=running    agent_alive rc=0   log: plot-monitor AgentMonitor …
```

Both `finished` desks have a **live recorded pid** (27820, 243), a clean tree, and a loop actively waiting. The third is a genuinely working agent and reads correctly. The symptom is exactly as the plan describes, and the path is the one the plan and the prior panel both name.

## 2 · Every link of the asserted chain

| # | Link | Verified | Evidence |
|---|---|---|---|
| 1 | `registry.ts:826` → `bashLiveness` | **yes** | `defaultLiveness` returns `(worktrees) => bashLiveness(scriptsDir, worktrees)`, verbatim at :824-827 |
| 2 | `bashLiveness` sources the shell | **yes** | `. "$1"; … plot_worker_state "$wt" '' \| cut -f1`, one NUL-delimited answer per worktree (:865-882) |
| 3 | answer reaches `refreshStates` → `entry.state` | **yes** | `:725` `await refreshStates(out, opts.liveness ?? defaultLiveness(opts.scriptsDir))` |
| 4 | that state reaches `dropSettledWorkers` | **yes** | `:728` `dropSettledWorkers(out, opts.cleanliness ?? defaultCleanliness())` |
| 5 | first pass keeps only `running` | **yes** | `:958` `if (e.state === 'running') continue;` — quoted correctly |
| 6 | the row is actually dropped | **yes, with a caveat the plan omits** | see below |

**Link 6 has a precondition the plan does not state.** `defaultCleanliness()` returns `() => []`, which drops *nobody* — a length mismatch makes `dropSettledWorkers` return every entry. Dropping only happens because **`fleet.ts:2983` passes `cleanliness: bashCleanliness`** explicitly. I verified that call site. So the chain is real on the board's live path, but it is four hops, not three, and the fourth is in a different file. The plan asserts the drop unconditionally; it is conditional on a wiring the plan never names. This does not falsify the claim — on the board path it is true — but it is an unstated link, and unstated links are how the predecessor plan went wrong.

A waiting desk's tree is clean (`dirty=0`, `unpushed=0` — measured), so `bashCleanliness` answers `clean` and the row is dropped. **Nothing downstream keeps it.** Confirmed.

## 3 · The negative claim — CONFIRMED, both implementations

The plan says both `workerAlive` implementations read `.plot-worker.pid` and never touch the shell. **True, and I read both:**

- `entry/registryd-main.ts:479` — `fileOrNull(join(worktree, '.plot-worker.pid'))`, `Number(text.trim())`, `processes.isAlive(pid)`. Unanswerable reads as `true`.
- `server/supervisor.ts:324` — `options.recordedPid(worktree)`, `if (pid === null) return false`, `options.isAlive(pid)`.

Neither sources `plot-worker-state.sh`. The predecessor's `stateOf`-poisoning story is dead, and this rewrite is right to bury it. **The assignment path is genuinely untouched**, so the narrowing to "this is a DISPLAY defect" is correct and is the rewrite's strongest move.

## 4 · What I could NOT verify — and it is the load-bearing claim

### The discriminator does not discriminate

The plan's proposed arm is: **recorded pid alive AND no `.plot-worker.exit`** → `running`.

I enumerated every desk on the estate by the two facts:

```
live pid + no exit  : 3   ← includes BOTH waiting desks AND the healthy working one
live pid + exit     : 0
dead pid + no exit  : 9
dead pid + exit     : 6
```

**The `live + exit` cell is empty, and it is empty structurally, not by accident.** `plot-dispatch.sh:1074` does `rm -f "$wt/.plot-worker.exit"` at desk reset, and the wrapper writes the file only *after* `wait` returns on the agent — by which time the wrapper is exiting. So **while the recorded pid is alive, `.plot-worker.exit` is essentially always absent.**

That makes the plan's guard nearly a tautology inside the live-pid block. It does not separate a waiting loop from anything else in that block; it fires on the whole block. The plan's own claimed safety property — *"a dispatched agent with no `claude` child and an EXIT RECORD still reads `finished`"* — protects a population that, inside this code path, **does not exist**. The real `finished` population is reached further down, in the dead-process block at `:888`, which the new arm never touches. So the guard is not wrong, it is simply inert, and the plan mistakes an inert guard for a safety argument.

Worse in one direction: the arm as written would also swallow the case the shell's own comment at `:828-846` was built to catch — a desk whose recorded pid is alive but is **not** an agent (the CI measurement of 2026-09-12, where the recorded pid was the test runner, alive 1436 s). The plan says the root-exclusion "stays exactly as it is," but placing an unconditional `running` arm *before* `plot_worker_agent_alive` is asked is precisely what disables it. The plan asserts it adds a reading rather than loosening one; I could not verify that, and I believe it is false as drafted.

### The "one slice, both sides" claim

The plan says `rules/agent-state.ts` "gains the same arm from the same readings." **It cannot, as described** — see §5. The readings the domain receives do not carry a live-pid-plus-no-exit pair in the shape the plan assumes; `exit` arrives as `-` for the orphaned case and the liveness word already encodes the answer. The corpus pair would be satisfied, but by a different edit than the one the plan writes.

## 5 · The nearer mechanism the plan ignored — `orphaned`

This is the finding that decides my position.

`plot_worker_readings` (`plot-worker-state.sh:1004-1029`) already classifies the recorded pid into **four** words: `live`, `stale`, `orphaned`, `dead`. And:

```
$ plot_worker_readings <waiting desk>
here|pidRec|liveness|exit|blocked|dirty|unpushed
1|1|orphaned|-|0|0|          ← free-719604d9   (waiting)
1|1|orphaned|-|0|0|          ← free-fe7ff576   (waiting)
1|1|live|-|0|0|0             ← free-c810e5bb   (working)
```

**`orphaned` is exactly the plan's target population, already named, already measured, already crossing the seam.** Its own docstring at `rules/agent-state.ts:19-31`:

> `orphaned` — the pid answers and is the right process, and no agent runs … an orphaned wrapper has not exited and never will within its bound

That sentence is the plan's thesis, written into the estate before the plan was drafted.

And the domain reproduces the bug from it:

```
$ printf '1\t1\torphaned\t-\t0\t0\t\n' | node skills/plot/scripts/board/plot-agent-state.mjs
finished
```

`rules/agent-state.ts:140` — `if (readings.liveness === 'orphaned') return taskState(readings.task);` — with the comment saying it routes to the desk *because three of four such desks held finished work*. **That measurement was taken over dispatched desks. The free/waiting agent is a fifth population it never saw**, and for that population the desk is clean by definition, so `taskState` returns `finished` every time.

So the honest defect is one sentence, and it is narrower than the plan's:

> `orphaned` conflates *the wrapper outlived its agent* (a dispatched desk — route to the desk, correct) with *the loop has not yet been handed an agent* (a free desk — it is running). The two are distinguishable, and `plot_worker_agent_alive`'s negative answer is being read as the first when it is the second.

The discriminator that separates them is not `.plot-worker.exit`. Candidates I would expect a rewrite to weigh — and the plan weighs none of them:
- the manifest's `branch` **read through the registry** rather than by the shell (the predecessor's idea, rejected for reasons that were about *where* it was read as much as *what*);
- whether the desk ever had an agent — a launch-time fact, which is what the panel actually recommended (`.plot-worker.wrapper.pid` is the precedent, and the plan cites it but then does not use it as a *discriminator*, only as a precedent for a different file);
- a fifth liveness word, which is the shape the estate already uses for exactly this kind of split (`stale` and `orphaned` were both added this way, per the `:1017-1023` comment: *"THE FOURTH WORD, and it belongs in this field"*).

That last one is the estate's own idiom, keeps the change inside `plot_worker_readings` + one arm in `agentState`, keeps the corpus pair honest on both sides in one slice — which is what the plan wants — and does **not** require touching the live-pid block or endangering the root-exclusion. It is smaller than what the plan proposes and lands in the place the estate has twice chosen for this question.

## 6 · Is the change the smallest that fixes it? — No

The plan's edit sits in `plot_worker_state`'s live-pid block and adds a second, parallel place where liveness is judged. `plot_worker_readings` already judges liveness, and the two functions are explicitly kept in step — `:1011-1014` repeats the wrapper gate with the comment *"repeated here because these two must not drift."* Adding an arm to one and "the same arm from the same readings" to the domain means **three** places encoding one judgement. Fixing the word in `plot_worker_readings` and the arm in `agentState` is two, which is the number the estate already pays.

## 7 · What would break if this shipped as written

1. **The 2026-09-12 CI regression returns.** An unconditional `running` before `plot_worker_agent_alive` re-admits the desk whose recorded pid is the test runner. The plan's claim that the root-exclusion is untouched does not survive the ordering it specifies.
2. **The corpus pair drifts or the slice grows.** `agent-state.corpus.test.ts` compares `agentState` against `plot_worker_state` over real desks, and `docs/shell-and-domain.md` forbids adjusting either side to make it pass. A shell arm keyed on a file the readings render as `-` has no faithful domain counterpart, so the slice either fails the pair or quietly changes what `orphaned` means without saying so.
3. **`orphaned`'s dispatched population changes meaning silently.** The three-of-four measurement behind `:140` is real work on real desks. Any edit here must keep dispatched orphans routing to the desk. The plan never mentions `orphaned`, so it cannot have checked this — and it is the one regression with work on the floor behind it.

## 8 · What I endorse, unchanged

- The symptom, the location, and the four-link chain to `dropSettledWorkers`.
- The negative claim about both `workerAlive` implementations — verified, and the predecessor's story is correctly buried.
- "This is a DISPLAY defect, not an assignment defect." Correct, and the right narrowing.
- `dropSettledWorkers` untouched; no ninth state; the answer is `running`. All three are right.
- Keeping the predecessor plan rather than deleting it.

## What the amendment is

Keep the diagnosis and every guard. Replace §"The discriminator is a process fact" and the slice body with:

1. Name `liveness=orphaned` as the actual carrier, with the measurement above.
2. Split it — free/waiting vs. dispatched-orphan — in `plot_worker_readings`, by a launch-time or registry fact, **not** by `.plot-worker.exit`, and preferably as a fifth word, per the estate's own precedent at `:1017`.
3. Add the matching arm in `rules/agent-state.ts` above the exit arms, so the corpus pair moves together in one slice as the plan already intends.
4. Add a test pinning that a **dispatched** orphan still routes to `taskState` — the three-of-four population that must not regress.
5. State the `fleet.ts:2983` `bashCleanliness` wiring as the fourth link, so the chain in the plan is the chain in the code.

The plan is one measurement away from being right, and that measurement is `plot_worker_readings` on a waiting desk — which takes one command and answers `orphaned`.

Position: amend

# Corpus-pair lens — a waiting loop has not finished

Position: reject

## Summary

The plan's premise was true when it was written and is false now. The exact defect it describes — a live wrapper with no `claude` descendant reading `finished` — was fixed on both sides between the plan's drafting and today, by four commits that introduced a **fourth liveness word, `orphaned`**, carried it across the wire, and taught `rules/agent-state.ts` to route it to `taskState`. The corpus pair already passes, and it passes because the pair was moved together at that time. The slice this plan proposes would add a **second, different discriminator** to one side only, and it is the corpus test that would catch it.

## 1. Does the stated problem exist, verified in the code?

**No — not as stated, and not at the line the plan names.**

The plan quotes `plot-worker-state.sh:848`, `:860` and `:870`, and describes the live-pid path as a two-arm branch:

```sh
if plot_worker_agent_alive "$pid"; then      # a claude descendant → running
elif [ "$?" -eq 1 ]; then                    # none → task state → finished
```

That branch is now at `:863`/`:866`, and it is no longer reached the way the plan assumes. Four commits landed on this path after the plan's analysis:

```
582ddea24 plot: ask about the agent only where Plot launched a worker
263882f36 plot: the hand-over gate is one function, and a starting agent is not an absent one
49b547512 plot: the rule reads an orphaned wrapper, and the parser stops guessing
64787cd4b plot: read whether an AGENT is alive, not merely its wrapper
```

What they added is precisely the plan's own discriminator, generalised:

- `plot_worker_agent_alive` (`:580`) returns **three** values, not two — `0` present, `1` absent, `2` unaskable — and a wrapper younger than `PLOT_AGENT_GRACE_SECONDS` returns `2`, which falls through to `running`. A loop that has just been launched and has spawned nothing is `running` already.
- `:859` gates the whole question on `.plot-worker.wrapper.pid`. A desk Plot never launched a worker into reports `running` outright. The plan cites that same file at line 848 as "the estate's precedent for a launch-time fact of exactly this kind" — it is no longer a precedent, it is the gate, already in place.
- `plot_worker_readings` (`:971`) prints a **fourth liveness word**, `orphaned` (`:1024`), meaning *the pid answers and our worker is no longer inside it*.

The residual symptom is real but it is not the plan's diagnosis. Measured on this estate just now:

```
free-719604d9  STATE=finished  READ=1 1 orphaned - 0 0
free-fe7ff576  STATE=finished  READ=1 1 orphaned - 0 0
free-c810e5bb  STATE=running   READ=1 1 live     - 0 0 4
```

An orphaned wrapper on a clean desk still answers `finished`. But `plot-worker-state.sh:867` now states that as a **decision, argued and measured**, not an oversight: *"The wrapper is alive and the agent is gone. The DESK decides what that means... No exit file exists: the wrapper has not exited."* `rules/agent-state.ts` says the same in its `PidLiveness` docblock: an orphaned wrapper *"has not exited and never will within its bound, so there is no exit record and never will be — the only thing left to read is the desk. Measured 2026-09-11: four agents ended this way in one session, and three of the four desks held work one step from done."*

**So the estate has already considered the plan's exact fact — a live pid with no exit record — and decided the opposite way, with a measurement the plan does not address.** The plan says an absent exit record proves the loop is running. The estate says an absent exit record is *guaranteed* for an orphan and therefore carries no information, and three of four such desks were agents that had **died**, not agents that were waiting.

## 2. Is the proposed change the smallest one that fixes it?

Moot — but no. The plan's arm is:

> the recorded pid is alive AND no exit record exists → the loop is running, whatever its descendants

Applied to today's code that arm fires on **every** `orphaned` desk, because an orphaned wrapper *by construction* has no exit record. It would turn `free-719604d9` and `free-fe7ff576` — both of them, today — from `finished` to `running`, re-introducing the exact defect commit `64787cd4b` was written to fix: *"measured 2026-09-11, four agents ended mid-slice and every one reported `running`."*

The plan's own "What must not break" section names a guard that does not hold here: *"A dispatched agent with no `claude` child and an EXIT RECORD still reads `finished`."* On this estate **no orphaned desk has an exit record**, and cannot. The guard protects the `dead` population (`exit=124`, `143`, `-`), which reaches the exit block by a different route and was never at risk.

## 3. What does the plan claim that I could NOT verify?

Three claims, and the lens question is the second.

**(a) "`AgentStateReadings` carries the same readings."** Half-verifiable, and the half that fails is the one the plan leans on. `AgentStateReadings` **does** carry `exit: ExitReading` — `string | null`, with `null` for absent and `''` for unreadable — so the exit-record fact *is* in the struct. The plan's "same readings" claim is therefore true at the type level, and I want to be precise about that: **the slice is not wider for want of a field.**

But the field is unreachable where the plan's arm would sit. `agentState` orders its arms:

```ts
if (readings.liveness === 'live') return 'running';
if (readings.liveness === 'stale') return 'ended';
if (readings.liveness === 'orphaned') return taskState(readings.task);
if (!exitIsNumeric(readings.exit)) return 'ended';
```

The `orphaned` arm returns **before** any exit arm, with an explicit comment: *"BEFORE THE EXIT ARMS, because an orphaned wrapper has written no exit file and the `-` it reports would otherwise fall through to `ended`, discarding the desk that is the only thing left to read."* So `exit` is present in the readings and deliberately not consulted for this population. The plan would have to reorder a comment-documented ordering, not add a reading. That is a **different** change from the one it describes, and a larger one.

**(b) "Both sides move to `running` together, in one slice."** Unverifiable as written, because the plan does not know that the shell side already has a word (`orphaned`) that the rule side already consumes. The shell/rule seam is no longer "add the same `if` to two files." It is: shell prints a liveness word → `readingsFrom` (`entry/agent-state.ts`) **recognises rather than defaults** it against a hardcoded `LIVENESS_WORDS` list and **throws** on an unknown word → rule switches on it. A fifth word means touching three files plus a **rebuilt board artifact**, and `asLiveness` is explicit that version skew is refused rather than guessed: *"A newer plot-worker-state.sh than this bundle prints a word it does not know; rebuild the board artifact."* The plan budgets none of this.

**(c) The predecessor-panel framing.** The plan presents `.plot/panels/2026-09-22-a-free-agent-is-not-a-finished-one/panel.md` as the thing to answer. It answers that panel faithfully. It does not re-verify the code, and the code moved. That is the root failure here, not a reasoning error.

## 4. What would break if this shipped as written?

**The corpus test fails, and it fails loudly — which is the system working.**

`corpus/agent-state.corpus.test.ts` compares `agentState(readingsFrom(desk.readings))` against `desk.state` for **every desk `git worktree list` returns**, both halves gathered in one bash pass by `readDesks` (`corpus/production.ts:523`). It is not fixtures-only and it is not live-only — it is *whatever this machine holds*, which right now is 21 desks spanning `ended`, `none`, `failed`, `finished`, `running`.

If the shell gains the plan's arm and the rule does not, every orphaned desk disagrees:

```
free-719604d9 :: state :: rule="finished" shell="running"
free-fe7ff576 :: state :: rule="finished" shell="running"
```

The lens question asked whether a shell answering `running` where the rule answers `finished` would fail the test. **It would, twice over:**

1. `it('answers what the shell answers, on every desk')` collects it as a disagreement.
2. `it('agrees on the desks that are alive right now')` filters on `readings.split('\t')[2] === 'live'` — the **liveness field**, not the state word. An orphaned desk is not in that subset, so it escapes there; but the first test catches it unconditionally.

And `docs/shell-and-domain.md` is unambiguous about what happens next: *"On a disagreement the branch stops. Which side is wrong is judgement. Adjusting either side to make the comparison pass is the one move forbidden."*

**Is one slice enough to move both sides atomically?** Mechanically yes — one commit can touch the shell, the rule, the entry parser and the rebuilt artifact. The corpus test is checked into the same repo and runs against the same checkout, so there is no window. The plan is not wrong about atomicity. It is wrong about *what* has to move: it believes two `if` statements, and the real set is shell + `LIVENESS_WORDS` + `asLiveness` + `agentState` arm order + `board-server.mjs`/`plot-agent-state.mjs` artifacts + the ordering comment that currently argues the opposite. A slice sized for the former will discover the latter mid-flight.

**Second breakage, independent of the corpus.** `registry.ts:824` `defaultLiveness` → `bashLiveness` routes the board's registry read through the **shell**. If the shell answered `running` for orphaned desks, `dropSettledWorkers` would keep all of them — including the four-in-one-session dead agents of the 2026-09-11 measurement. The board would stop dropping settled workers at all for that population, which is a worse display defect than the one reported: rows that never clear.

## 5. Existing mechanism, or a nearer one the plan ignored?

**Yes, and it is the decisive finding: `orphaned` already exists and is already paired.**

The plan says *"No ninth state... The answer is `running`"* and treats the choice as between a new state word and an existing one. The estate took a third route the plan does not mention: it added a new **reading** rather than a new **state**, in the field where such facts belong. `plot-worker-state.sh:1019` argues it directly: *"THE FOURTH WORD, and it belongs in this field rather than in a private branch inside `plot_worker_state`. `stale` set the precedent."*

That is the nearer mechanism, and it is not merely nearer — it is the same idea the plan has, implemented, wired across the seam, and held by the corpus pair. The plan's contribution over it is the claim that an absent exit record should flip the answer from `taskState` to `running`. That specific claim is contradicted by the measurement in the very docblock that introduced `orphaned`.

**If there is still work here, it is a different plan.** The honest open question the estate leaves is: *should an orphaned wrapper on a clean desk read `finished`?* Two desks on this machine say it does. The plan's operator complaint — "I started agents and see nothing" — may well still be real. But the fix cannot be "a live pid with no exit record is running", because that describes every orphan including the dead ones. It would have to distinguish *a loop that has never yet spawned an agent* from *a loop whose agent has gone*, and the only fact that separates them is whether an agent was **ever** seen — which nothing currently records, and which is a genuine new reading with a real slice behind it.

## Position

Position: reject

Not because the reasoning is poor — the plan is careful, and its root-exclusion analysis and its refusal of the manifest `branch: ""` discriminator are both right. It is rejected because it was written against a version of `plot-worker-state.sh` that no longer exists, its named line numbers no longer point at the code it describes, its discriminator now fires on a population the estate deliberately excluded with a measurement, and its single slice would break the corpus pair it claims would pass.

**The redraft should start from a fresh reading of `plot-worker-state.sh:859-877`, `rules/agent-state.ts`'s `PidLiveness` docblock, and the four commits listed in §1 — and state what is still wrong given `orphaned` exists.**

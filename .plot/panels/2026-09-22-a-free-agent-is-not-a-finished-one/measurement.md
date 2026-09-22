# Measurement lens — a free agent is not a finished one

Position: amend

## What I ran

Every reading below is from this machine, 2026-09-22, roughly 07:40–07:50 UTC (09:40 CEST). Shell helpers sourced in `bash`, never zsh. No process was killed except two `sleep` fixtures I spawned myself and reaped by exact pid.

## 1. Does the stated problem exist?

**Yes. Reproduced.** Not from the estate as found — the estate had moved — but from a fixture built to the plan's own description.

**The plan's own witness no longer holds.** `.plot/agents/a0583977-….json` is the single manifest on this estate, and it now reads:

```
branch: "feature/the-store-holds-what-the-host-said"   (plan says branch: "")
pid 1794, startedAt 2026-09-22T05:25:58Z, alive 02:16:45
```

The supervisor handed it the slice — exactly the repair the plan's own postscript describes. So the desk now reads:

```
plot_worker_state .worktrees/free-1146d4ff  →  running	1794
```

and its subtree holds `claude` at pid 86459. **`plot_worker_agent_alive 1794` returns 0.** The free-agent population was empty at the time I looked; there is no live instance of the defect on this estate right now.

**So I rebuilt it.** A desk carrying `.plot-worker.wrapper.pid`, a manifest with `branch: ""`, and a live `bash -c 'sleep 600'` as the recorded pid — a process with no `claude` descendant, which is exactly what a free loop shell is:

```
elapsed=41
plot_worker_state <fixture>  →  finished	71800
```

**`finished` for a live process. The plan's central claim is exact.** The path is `plot_worker_state:860` → `plot_worker_agent_alive` returns 1 → `plot_worker_task_state` on a clean desk with no marker and no PR → `finished`.

## 2. A timing dependency the plan does not name

The plan reports the reading as if it were stable. **It is not — it depends on process age.** Measured on one pid across the boundary:

| elapsed | `plot_worker_agent_alive` rc | resulting state |
|---|---|---|
| 2 s | 2 (unaskable) | `running` |
| 8 s | 2 | `running` |
| 23 s | 2 | `running` |
| **43 s** | **1 (absent)** | **`finished`** |

`PLOT_AGENT_GRACE_SECONDS=30` is the boundary. **A free agent reads `running` for its first 30 seconds and `finished` forever after.** The plan's table ("branch `""`, no claude child → free") is correct about the end state and silent about the transient, and the transient is why an operator watching a fresh `--start` sees the row appear and then vanish rather than never appear. That belongs in the plan.

It does **not** depend on load: the grace test is `ps -o etime=`, a wall-clock age, and it moved monotonically across three samples with the machine under real load (13 worktrees, several node suites live).

## 3. The two disproofs — one correct, one correct-by-accident

**`dropSettledWorkers` — the disproof is CORRECT.** Read at `packages/board/src/server/registry.ts:947`. Its first pass is `if (e.state === 'running') continue` and `if (e.worktree === '') continue`; it drops only ended-AND-clean. A free agent reading `finished` with a clean desk is dropped *correctly by that rule*. The lie is upstream in the state word, exactly as the plan says. Changing this predicate would indeed be treating the symptom. **No correction needed.**

**The timezone disproof — the CONCLUSION is right and the REASONING is wrong, and that matters.** The plan says the `startedAt`/`ps -o lstart` comparison "is NOT a timezone defect — measured, both with and without `date -u`, the pid reads current."

The pid does read current. **But there IS a timezone defect, and it is 7200 seconds wide on this machine.** Measured:

```
manifest "2026-09-22T05:25:58Z" parsed by plot_pid_is_current (no -u)  → 1790047558  (read as 05:25:58 CEST)
the same instant parsed correctly with -u                              → 1790054758
ps lstart "Tue Sep 22 07:25:58 2026" parsed locally (correct)          → 1790054758
delta = 7200
```

`plot_pid_is_current:188` parses an explicitly-UTC `Z` string **without `-u`**, so the manifest epoch lands 2 h early, while `lstart` is parsed as local time and lands correctly. The two sides use different timezone assumptions.

**The direction is permissive, which is why "the pid reads current" was true and proved nothing.** The check is `proc_epoch >= manifest_epoch - 2`. An under-computed manifest epoch makes it easier to pass. Confirmed by constructing the case the check exists for:

```
pid 1794 (started 07:25:58Z) vs a manifest stamped 1 hour LATER (06:45:17Z)
plot_pid_is_current → rc=0   # reads CURRENT; should be stale
```

**A reused pid whose process started up to 2 hours before its manifest reads as the real worker.** The staleness guard — the whole reason `startedAt` exists, per the file's own header — has a 7200-second hole on every machine east of UTC, and none at all on a UTC machine, which is what CI is. The plan's test ("does the pid read current?") could only ever return *yes*, because the skew and the healthy case push in the same direction.

**This is a real defect the plan's disproof will stop the next reader finding.** It is not this plan's bug and must not be folded in — but the note must be amended from *"is NOT a timezone defect"* to *"the skew is real, measured at 7200 s, permissive in direction, and unrelated to this plan; it has its own defect to file."* A disproof that sends the next reader away from a live bug is worse than no note.

## 4. Is the proposed change the smallest one? No — and there is a nearer mechanism the plan ignored

**This is my amend.** The plan proposes `free` as a **ninth process state** in `plot-worker-state.sh`. The estate has already answered this question, and answered it the other way.

`packages/domain/src/rules/free.ts` holds `isAgentFree`, `whyNotFree` and `isFree`, with `packages/domain/test/free.test.ts` beside them:

```ts
export const isAgentFree = (reading: AgentReading): boolean => {
  if (reading.state !== 'running') return false;
  return reading.branch === '' || reading.sliceHasMerged;
};
```

**That is the plan's table, already built, already tested, already reading the manifest's `branch` as the discriminator.** And it is already rendered — `packages/board/src/app/lib/tuple-row.ts:960`:

```ts
export const agentAvailability = (agent, sliceHasMerged): string =>
  (isAgentFree({...}) ? 'free' : '');
```

whose docblock states the design decision the plan re-opens without citing:

> *"An agent between slices is running with no branch and is available, so it renders `running` from `agentStateStatus` and `free` from here at the same time, and both are true."*
> *"A SEPARATE FUNCTION RATHER THAN A WIDER `agentStateStatus`, because the two answer different questions from different inputs."*

**The estate's settled position is that `free` is a DERIVATION over `(state, branch)`, deliberately not a state word.** `free.ts:54` says so in as many words — *"DERIVED, NEVER STORED."* The plan proposes making it a stored process state, does not mention `isAgentFree`, and does not argue against the reasoning already recorded against it.

Note the collision is precise: `isAgentFree` requires `state === 'running'`. The defect is that the shell answers `finished` where it should answer `running`. **The existing rule already gives the right answer — it is being fed the wrong input.** That is the same diagnosis the plan makes about `dropSettledWorkers`, applied one layer further out, and the plan does not apply it to itself.

**The smaller change** is to make the shell answer `running` for a live loop with no branch — leaving `free` to the derivation that already exists — rather than to mint a ninth word. The plan's own principle ("feeding it a truthful one is the fix") points there.

## 5. What breaks if it ships as written

Three measured breakages, none named in the plan, all outside the single slice's declared scope:

**(a) `free` renders in WORKING — the outcome the plan's own Notes forbid.** `packages/board/src/contract/schema.ts:3271`:

```ts
const NOT_LIVE_STATES = new Set(['finished','stalled','failed','ended','none','elsewhere','unknown']);
export function isLiveState(state: string): boolean { return !NOT_LIVE_STATES.has(state); }
```

**It is a denylist.** `isLiveState('free')` returns `true`. The plan's last line says *"`WORKING` filtering to live states is correct and stays: a free agent is not working."* It would not stay. The new state lands in WORKING by default, and the schema comment at `:3249` names this exact hazard as already-measured:

> *"Widening the enum without widening this is the measured hazard: the four states added 2026-09-04 would each have read as a live worker and rendered in WORKING."*

**(b) Three existing tests fail.** `packages/board/test/unit/schema.test.ts`:

- `:478` `expect(AgentStateSchema.options).toEqual([...DomainAgentStateSchema.options, 'unknown'])` and `:479` `toHaveLength(8)` → 9
- `:494` `expect(AgentStateSchema.options.filter(isLiveState)).toEqual(['running','waiting'])` → `['running','waiting','free']`
- `:291` `expect(AgentStateSchema.options).toHaveLength(9)` → 10

The plan's slice says the change leaves "every other arm unchanged" and touches only `plot-worker-state.sh`. A ninth shell state propagates into `packages/domain/src/entities/agent.ts` by design — `:472` of the test file is titled *"a ninth shell state reaches the board without an edit"* — so the schema change is automatic and the test failures are too. **The slice as scoped cannot be green.**

**(c) The word `free` is already taken in the rendering layer.** `agentAvailability` emits the string `'free'` today, from a different input. A state word with the same spelling makes two different derivations print one word, which is the shape this repo's own scan section 9-11 split apart.

## What I could not check

- **The plan's `/api/fleet agents: 0` reading.** No board is running that I would start or stop, and the manifest has since been handed a branch, so the input no longer exists. I take it on the plan's word; it is consistent with `dropSettledWorkers` dropping a `finished`+clean entry.
- **The dead-supervisor postscript** (131 MB log, `launchctl` status `-`, last tick 15:52). The log has been rotated and the daemon restarted; nothing survives to re-read. The `--status`-reads-the-label defect it names is plausible and I did not verify it, and it is correctly deferred to its own plan.
- **13 `free-*` worktrees against 1 manifest.** Eleven are detached with no manifest at all. Those read `ended`/`failed` (measured: `free-04517165` → `ended 59907`, `free-2a5e7c4a` → `failed 42908 124`, `free-aa80a171` → `ended 4535`) and are a separate population — abandoned desks, not free agents. Whether the `free` state would have anything to say about them is unexamined by the plan and by me.
- **Whether the timezone skew has ever actually misfired in production.** I proved the window exists and is 7200 s; I did not find an incident in it.

## Summary

The bug is real and I reproduced it exactly. The `dropSettledWorkers` disproof is sound. But the plan proposes a ninth state word where the estate already holds a tested derivation with the same name and the same inputs, has a recorded argument against exactly this move, and whose denylist-shaped live filter would put the new state in the one section the plan says it must not enter — while three existing tests fail inside a slice scoped to one shell file. And its timezone disproof, while reaching the right conclusion for this plan, is reasoning that will steer the next reader away from a live 7200-second hole in the staleness guard.

Amend: fix the shell to answer `running` for a live branchless loop, route `free` through `isAgentFree` where it already lives, name the 30-second grace transient, and rewrite the timezone note to record the skew rather than deny it.

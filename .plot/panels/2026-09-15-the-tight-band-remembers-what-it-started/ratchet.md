# Juror: ratchet — the tight band remembers what it started

Lens: state that persists across passes. Where it lives, who resets it, what happens across a restart, and whether the board can end up refusing forever.

## 1. Factual claims — verified against `origin/main` (a9601d4f)

Every quoted line ref and docstring on the plan's path is **true on main right now**. I checked each from `git show origin/main:` rather than the worktree.

| Claim | Verified |
|---|---|
| Three bands `clear`/`tight`/`starved`, `machine.ts:57-58` | TRUE — `machine.ts:56-59`, the `headroomFor` chain. Off by one line; harmless |
| `HEADROOM_THRESHOLDS = {clearBelowMs: 10, starvedAboveMs: 50}` | TRUE — `machine.ts:20`, literal, unchanged |
| The `dispatchDefers` docstring quote at `machine.ts:106-110` | TRUE — verbatim, correct lines |
| The `auto-dispatch.ts:1055-1058` "reading, not an override" quote | TRUE — verbatim, correct lines |
| `controls.parallelAgents` checked at `auto-dispatch.ts:1069` | TRUE — `const budget = controls.parallelAgents - (liveCount + allInFlight.size)` |
| `Machine` carries `spawnCostMs`, `sampleMs`, `measuredAt`, `headroom` and nothing about what is running | TRUE — `machine.ts:30-42`; six fields, `loadAverage` and `cores` are the other two, both documented "context only" |
| "the only state that decays instantly" | TRUE — `machine.ts:27`, verbatim |
| `dispatchDefers` is deliberately not the negation of `hasRoomToDispatch` | TRUE, and stronger than the plan says — `machineDefers` (`auto-dispatch.ts:411-419`) wraps it |

**Could not verify:** "two agents produced twelve processes", "84 plot processes", "~24 GB compressed memory", "`/api/board` at 10.7 s", "a tree of 42 processes". None of these appear in `board.log`; they are operator observations with no artefact. They are context rather than load-bearing, so I do not hold them against the plan — but the plan says *"Every reading below is from that log or from the code on the path"*, and these are from neither.

**One unstated fact that matters to my lens and the plan never mentions:** `machineOverride` exists (`fleet-settings.ts:99`, `auto-dispatch.ts:416`) and is a live operator escape from `machineDefers`. See §5.

## 2. Re-derived the log measurement

```
wc -l .plot/logs/board.log            → 176
grep -c 'dispatching anyway'          → 63
grep -c 'not yet'                     → 39
```

Both counts **exact**. Spawn-cost distribution among the 63 tight lines:

```
count=63  min=41.0  max=50.0  median=46.6
below 41: (none)   above 50: (none)
```

The plan says "Min 41.0, median 46.4, max 50.0". **Min and max exact; the median is 46.6, not 46.4.** A one-bucket slip, immaterial to the argument. "every one at or above 40, and not one above the 50 ms line" is **exactly true**.

The distribution is genuinely tight and genuinely parked at the top of the band — 30 of 63 readings sit at 46.6 or above, and the modal value is 48.0 (×7). The plan's characterisation is fair.

## 3. The diagnosis is right

Yes. `Machine` is a reading with six fields and none of them counts anything started. `headroomFor` is a pure function of one number. `planAutoDispatch` is pure and `maybeAutoDispatch` is synchronous (`machine-reading.ts:14-20` says so deliberately). Nothing in the path carries a count of dispatches across passes.

The gate is not broken — `machineDefers` returns null on `tight` by design, `dispatchDefers` passes only `starved`, and both docstrings argue the distinction explicitly. **63 tight dispatches is the specified behaviour executing 63 times.** The plan correctly declines to blame the gate, and correctly declines to move `starvedAboveMs`.

## 4. THE RATCHET FINDING — the reset condition never occurred, not once

**This is my lens's verdict and it is decisive.**

I ran the reset condition against the plan's own evidence:

```
All 102 spawn-cost readings in board.log, bucketed by HEADROOM_THRESHOLDS:
  below 10 ms  (clear)   →  0
  10–50 ms     (tight)   → 63
  above 50 ms  (starved) → 39
```

**Zero `clear` readings.** The lowest reading in the entire incident is **41.0 ms** — more than four times the `clearBelowMs: 10` line. The proposed reset condition did not fire once across 102 measurements.

**So under this plan, the incident log produces: one dispatch, then silence for the rest of the process lifetime.** Not "one per tight run" — one, total. The 63 tight readings become 1 dispatch and 62 refusals, and the 39 starved readings contribute nothing to recovery because `starved` is not `clear` either. Nothing in the log could ever have cleared it.

The plan's own sentence — *"a ratchet that never resets is a refusal wearing another name"* — **describes what it ships on the data it was written from.** It names the failure mode and then does not test for it, because the `Done when` pins reset with a synthetic `clear` reading the incident never produced.

**Is `clear` reachable at all?** I measured this machine live, at load 7.90 with no incident running: fork costs of 0, 0, 40, 50 and 150 ms across five samples. A sub-10 ms reading requires a genuinely quiet machine. `machine-reading.ts:26` assumes one — *"Five forks at 4.8 ms is 24 ms"* — but that 4.8 ms figure appears nowhere in 102 live readings. **`clear` is the state this estate's board was never observed in.** The thresholds' own docstring calls them *"Provisional: they come from one session's samples and are to be re-measured"* (`machine.ts:18-19`) and they never were.

**This is the ceiling panel's shape, and it is worse.** There, `loweredConcurrency` only falls and a restart recovers. Here:

| | ceiling (`applyReaction`) | this plan |
|---|---|---|
| Direction | falls only | one-shot, then latched |
| Reset | restart | a `clear` reading — **observed 0 times in 102** |
| Escape | fix config + restart | **none specified** |
| Floor | `MIN_CONCURRENCY` = 1, still dispatches | **0 — nothing dispatches** |

The ceiling ratchet pins a board at slow. This one pins it at stopped. And the ceiling panel's finding was *"only a restart recovers"* — here a restart recovers too, and that is the whole recovery story, unwritten.

**Where the state would live, and it is the same object.** `maybeAutoDispatch` (`auto-dispatch.ts:959-967`) is synchronous and takes `briefsAsked: Set<string>` as caller-held cross-pass state, mutated in place; `fleet.ts:2956-2966` passes `entry.briefsAsked` from the `CacheEntry`. That is the natural home, and `prConcurrency` — the ceiling panel's exact ratchet — lives on the same `CacheEntry` at `fleet.ts:698`, initialised at `:3048`. **The plan proposes putting a second latch on the object that already carries the one a sibling panel just condemned, and says nothing about either.**

**Across a restart:** it clears, because `CacheEntry` is rebuilt (`fleet.ts:3042-3048`, *"Empty at construction — nothing was dispatched before this process began"*). That is the only recovery path the design admits, and the plan never states it. `briefsAsked`'s docstring states its restart behaviour explicitly (`fleet.ts:609-612`); this plan's one bit would be the field that does not.

**The plan's own framing invites this.** *"the new state is one bit beside the existing controls"* — the controls are `autoDispatch`, `parallelAgents`, `machineOverride`, which are **operator-settable and persisted** (`fleet-settings.ts:312-325`). A latch placed there is one an operator can see and clear. A latch on `CacheEntry` is neither. The plan does not say which it means, and the two have opposite answers to *who resets it*.

## 5. `machineOverride` does not cover the new refusal, and nobody noticed

`DESIGN-machine.md` §10, quoted at `auto-dispatch.ts:393-397`: *"the operator can always say now anyway — and that is what keeps this a deferral rather than a veto."* `machineOverride` implements that, and it gates **`machineDefers` only** (`:416`), which is the `starved` path.

The plan's new refusal is in the `tight` path and outside that gate. **So the estate's one documented escape from a machine refusal does not clear this one.** A ratchet stuck with no `clear` reading in sight cannot be overridden by the control that exists precisely to stop machine readings becoming vetoes — and the plan turns a deferral into a veto in the band it claims to leave alone. That is a direct conflict with a cited design document, unaddressed.

## 6. What `Done when` fails to pin

The gates are well-chosen for what they cover, and I would keep every one. They do not pin:

1. **That `clear` is reachable.** The reset test *supplies* a clear reading. Nothing asserts one occurs in practice, and the incident says none did. **An implementation satisfying every stated gate ships a board that dispatches once and then stops, and every test is green.** This is the "satisfy every gate and still be wrong" answer, and it is not hypothetical — it is what the plan's own evidence produces.
2. **Where the bit lives and who owns its lifetime.** `CacheEntry` (invisible, restart-cleared) and `FleetSettings` (operator-visible, persisted) both satisfy "one bit beside the existing controls" and differ in every property my lens cares about.
3. **Restart behaviour.** Not asserted, not stated. Sibling cross-pass fields document theirs.
4. **Any escape.** No override, no decay, no time bound, no "N passes then release". `machineOverride` demonstrably does not reach it.
5. **What the operator sees when refusing.** The gate keeps the `tight` line on the *permitted* dispatch. The 62 subsequent refusals print nothing specified — so the incident's loudest symptom becomes silence, which `auto-dispatch.ts:1055-1058` exists to prevent. A board that stopped dispatching and says nothing reads as *Plot is stuck*, the exact confusion that line was written against.
6. **Multi-board interaction.** `sharedInFlight` coordinates across boards (`auto-dispatch.ts:441-446`); a per-board latch does not, and the plan's own Notes say three spawners were live.

## 7. The strongest argument against doing this at all

**The measured incident had a cap set to 5 and produced 84 processes, so the binding constraint was never the machine reading — and this plan changes the reading while leaving the constraint.**

The plan says so itself: *"the cap counts the wrong noun"*, *"the incident's 84 included desks spawned by a second caller the board cannot see"*, and *"three spawners — board, supervisor, operator — each honoured a cap none of the others could see"*. It then scopes the second caller out and calls it *"the more interesting one"*.

So: the board is one of three spawners; it is bounded at 5 agents; the ratchet takes it from 5 to 1 (or, on this evidence, to 1-then-zero); and the other two spawners are untouched. **The incident recurs at 80 processes instead of 84, and the board is now latched off with no escape.** That trade — a permanent, un-overridable refusal on one of three actors, to remove roughly 5% of the load — is a poor one, and the plan has the facts to see it and does not draw the line.

The honest alternative it never weighs: **the second caller's plan is the fix**, and this one is a latch added to the wrong actor while waiting for it.

## Verdict

The premise is sound and unusually well-disciplined — it correctly refuses to blame the gate, correctly refuses to move a threshold, and the log re-derives almost exactly. The diagnosis is right: a reading has no memory.

But the mechanism proposed to fix it **cannot recover on the evidence it was written from**. Zero `clear` readings in 102. The reset condition never fired once during the incident this plan exists to prevent, the estate's one documented machine-refusal escape does not reach the new refusal, and the latch would sit on the same object as the ratchet a sibling panel condemned this week. A board that dispatches once and then stops, silently, with no override, is a worse failure than 63 affordable dispatches.

What would make it proceed: a reset condition that actually occurs — `tight` itself decaying the bit after N passes or a time bound, or a threshold re-measurement establishing that `clear` is reachable on this hardware; the bit's home and restart behaviour stated; `machineOverride` extended to cover it; and a `Done when` gate fed **the real log sequence including its zero clear readings**, asserting the board is not latched off at the end.

Verdict: amend

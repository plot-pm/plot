# Premise lens — the tight band remembers what it started

## 1. The first premise is TRUE. Every code claim verifies.

- Three bands and the thresholds: `machine.ts:12` (`HeadroomSchema`), `machine.ts:20` (`HEADROOM_THRESHOLDS = { clearBelowMs: 10, starvedAboveMs: 50 }`), `machine.ts:54-59` (`headroomFor`). Verified literally.
- `dispatchDefers` is NOT the negation of `hasRoomToDispatch`: `machine.ts:99` returns `headroom === 'clear'`; `machine.ts:110` returns `headroom === 'starved'`. The quoted docstring is at `machine.ts:103-106` and is verbatim.
- The `dispatching anyway` comment: `auto-dispatch.ts:1054-1057`, not `:1055-1058`. Off by one line; the quoted sentence is verbatim.
- `Machine` fields: `spawnCostMs`, `headroom`, `measuredAt`, `sampleMs`, `loadAverage`, `cores` (`machine.ts:30-41`). The plan omits `loadAverage` and `cores` from its list but its point — nothing about what is already running — holds for all six.
- "the only state that decays instantly": `machine.ts:26`. Verbatim.
- `controls.parallelAgents` checked at `auto-dispatch.ts:1069`. Verified.

**So the plan's self-correction was right.** The gate is not broken.

## 2. The measurement reproduces, except the median, and the framing does not.

Counts reproduce exactly: **63** `dispatching anyway`, **39** `not yet`. Among the 63 tight readings: **min 41.0, max 50.0**, none below 40, none above 50.

**Median is 46.6, not 46.4.** Minor, but the `Done when` names 41.0, 46.4, 50.0 as "the measured sequence", so the fixture would encode a number the log does not contain.

**The framing does not reproduce, and this is a finding.** The plan says "during a live incident" and "the machine spent the entire incident parked in the top of the `tight` band."

- `.plot/logs/board.log` carries **no timestamps at all**. Nothing in it can be time-bounded to one incident.
- It contains **8 `Plot board:` restart markers**. The 63 readings are spread across **six** board sessions: 31, 1, 1, 1, 29, 0. Not one incident — at least six.
- Tight and starved **interleave**. In the largest run, 31 consecutive tight readings are followed immediately by `not yet: spawn cost 116.0 ms` and `250.0 ms` (board.log:32-33). The machine did reach `starved`, repeatedly — 39 times. "A machine that never reaches `starved` never stops" is contradicted by this same log.

## 3. THE SECOND PREMISE IS FALSE. The tight passes dispatched nothing.

This is my finding, and it is the one the lens exists for.

**The plan's mechanism is: "Each pass reads `tight`, dispatches one more."** I traced what those 63 passes actually did. They dispatched **zero** agents.

Evidence, all from the same log the plan measured:

- The log holds exactly five message shapes: 63 tight, 39 `not yet`, **32 `skipping plan(s) with nothing startable`**, **26 `skipping branch(es) with no brief on origin/main`**, 4 `skipping claimed branch(es)`.
- The skip reasons are `no-brief`, `no-eligible-wave`, `ref-held` (board.log:36, :54, :70). Every pass that named a plan named it as **unstartable**.
- **Zero** `at cap` lines. `auto-dispatch.ts:1069-1095` logs a cap refusal whenever `budget <= 0` and there is eligible work. It never fired — so the board was never at its cap of 5 during any of this.
- **Zero** `asked the Brief command` lines (`auto-dispatch.ts:1229`).

**And the decisive asymmetry in the code.** The deferral line is gated on eligible work (`auto-dispatch.ts:1044-1049`, comment: *"a deferral with nothing to dispatch is routine, not a decision anybody needs to read every five seconds"*). The tight line, eight lines below at `:1058`, **has no such gate**. It prints on every pulse the reading is tight, whether or not anything is startable, and before `planAutoDispatch` is ever called.

So `dispatching anyway` does not mean a dispatch happened. It means *this pulse would not have been stopped by the machine* — and in all 63 cases the pulse was stopped by something else, immediately afterwards.

**A log line printed once per 5 s pulse for six board sessions is a cadence, not a count of forks.** The plan reads 63 print statements as 63 dispatches. That is the same error shape as the four rejections cited: a single reading stated as a standing fact.

**The 84 processes and 42-process tree are therefore unattributed.** They are real — but nothing in the evidence connects them to the board's auto-dispatch. The plan's own Notes name `plot-registryd` and an operator as two other spawners the board cannot see; `.plot/logs/registryd.log` is 67 MB and 1.53 M lines, modified during the same window, and `plot-registryd.mjs --start-agents` starts up to three desks per tick on its own cap. The plan puts the supervisor out of scope, then attributes the process count to the component it keeps in scope, with no line of evidence joining them.

**And the existing cap is not the wrong noun in the way claimed.** `planAutoDispatch` computes `budget = parallelAgents - (liveCount + inFlight.size)` (`auto-dispatch.ts:479`), falls through to `freeAgentCount` only to reuse an already-paid slot, and the comment at `:490-493` explicitly forbids raising the ceiling. The board cannot exceed 5 concurrent agents regardless of the band. That "two agents produced twelve processes" is a fact about agents being multi-process — it is an argument for a per-process cap, which the plan explicitly declines to build ("It does not count processes"). The ratchet does not address it either: 5 agents at 6 processes each is 30 processes whether they started over one tight pass or twenty.

## 4. What `Done when` fails to pin

It pins a sequence of readings against a dispatch count, and pins the `clear` path byte-identical. An implementation satisfying every clause can still be wrong in three ways:

- **It never asserts a dispatch was possible.** A test feeding 41.0/46.4/50.0 and asserting one dispatch passes trivially if the fixture has nothing startable — which is the real log's condition. The pinning fixture must assert the three-tight baseline dispatches **three** today, or the test proves nothing about the ratchet.
- **"Until a `clear` reading intervenes" has no time bound.** On a busy estate `clear` (<10 ms) may not recur for hours. `starved` self-clears; a latch on `clear` can wedge the fleet indefinitely and every stated gate still passes. The plan calls a never-resetting ratchet "a refusal wearing another name" and then pins only that *a* clear reading resets it, not that one is reachable.
- **Where the bit lives is unpinned.** "One bit beside the existing controls" — if it goes in `FleetSettings`, it is operator-visible persisted state and survives restarts; if in module scope, every board restart clears it, and this log shows 8 restarts. Both satisfy the wording.

## 5. Strongest argument against

**The measured behaviour has a simpler and better-evidenced explanation, and this fix does not touch it.** 63 log lines, 0 dispatches, 0 cap hits, 58 explicit skip lines, 8 board restarts, and a 67 MB supervisor log running concurrently. The board's auto-dispatch was already refusing everything on other grounds. Adding a ratchet to a caller that dispatched nothing changes nothing about the 84 processes — while making the fleet strictly slower on every healthy tight pass, on a threshold the file itself marks *"Provisional: they come from one session's samples and are to be re-measured"* (`machine.ts:18-19`).

The out-of-scope item is the one with the evidence. The plan says so itself: *"That is its own plan, and it is the more interesting one."*

## What I could not verify

- That the 84 processes / 24 GB / 10.7 s `/api/board` readings came from the board's dispatching. The log carries no timestamps, no process counts, no memory figures. Those numbers are not in `board.log`.
- Which spawner produced the 42-process tree. No evidence either way was available to me.

## Recommendation

Amend. The mechanism claim — tight readings causing repeated dispatches — is not supported by the log it cites, and the log contradicts it. Re-measure with a board log that says what each pulse **started**, and attribute the process count to a spawner before fixing one. If the ratchet still looks right after that, the `Done when` needs the three clauses in §4.

Verdict: amend

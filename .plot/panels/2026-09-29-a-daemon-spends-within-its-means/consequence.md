Position: amend
Evidence: executed

# The consequence lens on `a-daemon-spends-within-its-means`

The plan's structure is sound and its restraint is real — it refuses to promote on silence, refuses to touch the board, refuses to claim #1059's fix. That is better discipline than the fourteen plans behind it.

What it gets wrong is **who is spending**, and the error is not a matter of degree. I measured the account this plan is about. The supervisor is **not** the unthrottled spender competing with a disciplined board. It is the smallest spender on the machine by an order of magnitude, and **the board is already stretched to 7.25× of its maximum 8** — because of load the supervisor did not create and this plan does not touch.

Building the plan as written adds a second backoff controller to a process contributing ~2% of the observed rate, on an account where the existing controller has already run out of room. **It cannot help, and it can hold slices.**

## 1. THE DIAGNOSIS IS WRONG, AND I MEASURED IT (question 4)

The plan's table asserts the supervisor spends without discipline while the board behaves. Both halves are true as written and the conclusion drawn from them is not, because neither half is a **quantity**.

The live record, read through the estate's own op — one host call, my only deliberate spend besides the two ticks below:

```
$ bash skills/plot/scripts/plot-host.sh spend-rate
{"connector":"github","account":"jwloka","bucket":"","spent":370,"spanMs":3597108,
 "perHour":370.30,"lines":193970,"unreadable":0,"limit":null,"remaining":null,
 "resetAt":null,"basis":"unknown"}
```

**370.3 requests an hour against a board share of 60.** And the whole computer, from `~/.plot/state/budget.tsv` (759,477 lines, live):

```
last 60 min: total=2687 -> 2687/hr
    ('bitbucket', 'api')     2291 -> 2291 /hr
    ('github',  'graphql')    353 ->  353 /hr
    ('jenkins', '')            40 ->   40 /hr
    ('github',  'core')         2 ->    2 /hr
```

I then ran the supervisor's own tick, instrumented, twice:

```
$ PLOT_SCRIPTS_DIR=$SD/shadow node skills/plot/scripts/board/plot-registryd.mjs --once
=== HOST CALLS: 2 ===
   1 pr-merged
   1 pr-list --state merged --limit 500

plot-registryd tick agents=1 left=1 reap=0 correct=0 person=0 defer=0 handed=0
  held=322 idle=0 already-merged=0 merge-unknown=0 no-brief=0 not-claimable=322
  no-free-agent=0 unclaimed=4 cost=9191ms
```

(The tracked script was not modified — `git status --short skills/plot/scripts/plot-host.sh` clean, 260859 bytes, before and after. The shadow is a symlink directory per `registryd-main.ts:93`.)

**Two calls, not four.** At a 60 s tick that is **120 requests an hour, ceiling**, and 4/tick would be 240.

So the arithmetic the plan never does:

| spender | requests/hour | share of 2687 |
|---|---|---|
| everything on this computer | **2687** | 100% |
| bitbucket `api` alone | **2291** | 85% |
| github `graphql` (the pool the supervisor uses) | **353** | 13% |
| **the supervisor, at its measured ceiling** | **120–240** | **4.5–8.9%** |
| the board, at its *observed* stretched interval | ~8 | 0.3% |

**The supervisor is at most 9% of the account and at most a third of its own pool.** The plan's sentence — *"the board throttles and the daemon keeps asking at a fixed interval, on the same account, competing with the consumer that is behaving"* — describes a competition the supervisor is losing by a factor of ten in the opposite direction from the one the plan assumes.

## 2. THE CONSEQUENCE THE PLAN CANNOT SEE: THE BOARD IS ALREADY AT THE CEILING

This is the finding I would not have got by reading. From the live board, `/api/fleet`:

```
prAgeSeconds     = 103
prNextInSeconds  = 332
prSpenders       = 6
```

103 + 332 = **435 s between refreshes**, against `PR_REFRESH_MS = 60_000` (`fleet.ts:132`) and `github: 1` in `PR_REQUESTS_PER_REFRESH` (`fleet.ts:200`). **The board is running at a stretch of 7.25 out of a hard ceiling of `MAX_CADENCE_STRETCH = 8`** (`cadence.ts:34`).

Replaying the rule's own arithmetic against the observed 370.3/hr:

```
observed perHour=370.30, share=60
target stretch = 8              <- the ceiling, immediately
 step 1: interval=165000ms (165s) stretch=2.75
 step 2: interval=243750ms (244s) stretch=4.06
 step 3: interval=302813ms (303s) stretch=5.05
 step 4: interval=347110ms (347s) stretch=5.79
 step 5: interval=380333ms (380s) stretch=6.34
 step 6: interval=405250ms (405s) stretch=6.75
observed board interval: 435s -> stretch 7.25
```

`targetStretch` returns `MAX_CADENCE_STRETCH` outright here, via the branch `cadence.ts:143`: `if (others >= share) return MAX_CADENCE_STRETCH`. `others` is 310/hr against a share of 60. **The board is not throttling gracefully — it is pinned, walking asymptotically into a wall it has nowhere to go past.**

`cadence.ts:34-48` states exactly what that means and the plan quotes none of it:

> **IT BOUNDS THE STRETCH, NOT THE SPEND.** An account genuinely spending eight times one board's share will exceed its budget, and that is the honest outcome: this rule divides a cadence, it does not enforce a quota.

**So the consequence of shipping this plan on this estate is: a second consumer joins a division that has already saturated, to divide away 4.5% of the load, while 85% of it (bitbucket) and the rest of the github pool are untouched.** The 429 does not stop. What changes is that slices now get held on purpose as well as by accident.

## 3. THE ONE I WAS ASKED TO TRACE — BACKING OFF COSTS MORE THAN THE INCIDENT (question 1)

The plan asserts holding is safe because it is already what silence does, and never counts it. Counting it:

`queue.ts:207` — `if (slice.landed === 'unknown') return 'merge-unknown'`, and the union member's own doc, `queue.ts:116-124`:

> **A HOLD RATHER THAN AN OFFER, WHICH INVERTS THE REAPER'S DIRECTION.** Silence there keeps a checkout that would otherwise be deleted; silence here would hand finished work to an agent. So **an unreachable host costs this pass its hand-overs and the next tick re-asks.**

The safety argument rests on *"the next tick re-asks"* — that a hold costs **60 seconds**. A deliberate stretch breaks precisely that clause. At `MAX_CADENCE_STRETCH = 8` the next tick is **8 minutes away**, and the hold now costs 8 minutes rather than one.

The comparison the plan owes and does not make:

- **The reported incident:** 429 twice in two hours, ~20 minutes of nothing each time. Call it **40 minutes lost in 120**.
- **A stretched supervisor on this estate:** the board reached 7.25× and is still climbing, driven by load the supervisor does not control. A supervisor reading the same record reaches the same ceiling and **stays there** — `others` (310/hr) exceeds `share` (60) continuously, not in bursts. That is not two 20-minute windows; that is an **8-minute hand-over cadence for as long as the estate is busy**, which on this machine is all day.

**Backing off converts an intermittent 20-minute outage into a permanent 8-minute one.** The plan's second property — *"a deferred question holds the slice, exactly as an unreadable one does today"* — is true about the *mechanism* and false about the *cost*, and the cost is the whole question.

And the feedback loop `cadence.ts:11-20` documents closes against the supervisor harder than against the board:

> the stretch is derived from spend, and a board that has stopped asking has stopped spending, so a board pushed past an hour has no reading of its own fresh enough to bring it back.

The board refreshes to render. **A supervisor that stops asking stops handing out work** — its spend and its entire purpose are the same calls. A board at the ceiling still shows a stale page; a supervisor at the ceiling is a fleet that hands over once every 8 minutes.

## 4. THE RULE IS NOT BOARD-SHAPED, BUT THE SUPERVISOR IS ALREADY IN ITS DENOMINATOR (question 2)

The naming question the plan makes a "Done when" is the least interesting thing here, and the answer is: **rename nothing, and the reason matters more than the name.**

`boardSharePerHour(intervalMs, costPerRefresh)` (`cadence.ts:71`) is pure arithmetic over an interval and a cost — it names a consumer nowhere. `othersPerHour` (`cadence.ts:101`) subtracts *this* consumer's derived contribution from an observed total. Both model *a consumer that polls on a fixed interval and can stretch*. Nothing is board-specific.

**But the convergence question the brief asks has already been answered, against the plan.** `cadence.ts:104-108`:

> The record holds one line per host call from **every spender on the computer**, this board's own calls included … The board's own contribution is DERIVED, not counted — it is exactly what its current interval spends.

And `plot-host.sh:2621`:

> **EVERY HOST CALL APPENDS ONE LINE, AND SO DOES EVERY REFUSAL.** … `gh`, `bb` and `jen` below are shell FUNCTIONS, and a function shadows a PATH executable for every caller in this file.

The supervisor reaches the host through `host-shell.ts` → `plot-host.sh`. **Its two calls per tick are already in the record.** They are already inside the 370.3/hr the board is dividing by — already part of `others`, already pushing the board toward its ceiling. `prSpenders = 6` counts them.

So the supervisor is **not** an unmeasured consumer the rule cannot see. It is a **measured** one that does not yet react. That changes the plan's premise in two ways it never addresses:

- The asymmetry table's *"spend rate read: none"* is true of the supervisor's **reading** and false of its **recording**. The plan presents an instrumentation gap; the gap is only in the reaction.
- Two spenders each subtracting only themselves from a shared total is exactly the case `CADENCE_DAMPING = 0.25` was measured for (`cadence.ts:57-64`: *"At 0.25, one through eight boards all settle at exactly 60.0"*). **They converge, they do not oscillate** — provided the account has headroom. This one does not: `others >= share` sends both straight to the ceiling by the `cadence.ts:143` branch, and they converge on **both being maximally slow** while the 2291/hr of bitbucket traffic that actually caused it carries on untouched.

## 5. THE SPEND RECORD IS NOT THE PROBLEM; THE CADENCE STATE IS (question 3)

The brief suspects cross-tick state. Half right, and the precise half matters.

**The spend record is not cross-tick daemon state.** It is a file on disk, per-computer (`ports/budget.ts`), append-only and lock-free, re-read from scratch by anyone who asks. Reading it in a tick breaks nothing — it is exactly the *"re-reads everything from disk"* recovery `registryd-main.ts:775` describes.

**`currentIntervalMs` is.** `cadenceStretch(perHour, intervalMs, currentIntervalMs, costPerRefresh)` takes the interval *this consumer is currently running at* — that is what makes the step damped rather than absolute, and `refreshIntervalMs` defaults it to the unstretched value when the caller has none. The board holds it in a `CacheEntry` living as long as the process (`fleet.ts:2526` reads `entry.prIntervalMs`).

A daemon that holds nothing between ticks has no `currentIntervalMs`. It would pass the default every tick, which means **`current` is always 1 and every tick takes a single damped step from scratch — reaching 2.75×, never 7.25×, and never converging on anything.** The damping that makes the rule stable is defeated by statelessness. So the plan must either persist the interval (breaking `registryd-main.ts:308`'s *"holds nothing between ticks by construction"*) or use the rule in a way it was not measured for.

**#1041 is this exact question, open, and the plan does not cite it:**

> *"Reporting idle from the supervisor's tick needs persistent state the daemon does not have"* … **`gone` moves cleanly** … **`idle` does not.** `rules/sample.ts` requires `sample(previous, current)`.

A second feature hitting the identical wall, with the first still unresolved, is a design question the estate owes an answer to once — not a thing for this slice to settle quietly in passing.

## 6. THE REPORTING BLAST RADIUS IS REAL (question 5)

The plan asks for a throttled hold to be distinguishable from an outage. There is nowhere cheap for it to go.

`QUEUE_HOLDS` (`queue.ts:137`) is a closed, **ordered** array of five whose order is load-bearing — `queue.ts:127-135`: *"The order is the order `whyNotReady` tests them"* — and it exists specifically so a count can report a zero. `HOLD_SCOPE` (`registryd-main.ts:996`) is a total `Record<QueueHold, …>` written total on purpose: *"a sixth hold must not default into silence … a missing key here fails the build."*

So a sixth hold is: a union member, a position in the tested order, a `HOLD_SCOPE` classification, and `registryd-tick.test.ts:882` (`expect(line).toContain('merge-unknown=0')`) plus `registryd-main.test.ts:498`'s loop over the hold names. That is a contained change and it is **not** the zero-cost annotation the "Done when" implies. The plan should name it.

There is a cheaper answer it does not consider: a throttled tick is not a new *hold* at all — the slice is held by `merge-unknown` for the same reason as ever. What differs is **why the tick did not ask**, which belongs on the tick line beside `cost=9191ms`, not in the per-slice hold vocabulary.

## 7. A FREE FINDING, SINCE I HAD THE INSTRUMENT

My tick spent a call on an **empty branch argument**:

```
   1 pr-merged            <- no branch
   1 pr-list --state merged --limit 500
```

`pr-merged` with an empty argument is one of two calls in the tick — **50% of the supervisor's per-tick host spend on this run asked about nothing.** That is a real defect, it is cheap, and it halves the number this plan is about without any of the machinery. It is plausibly the same duplicate #1059 is scoped to; if so, #1059 is worth more than this plan and should go first.

## Against my own position

**The strongest case for `proceed`, and it is not weak.** The plan is right that the supervisor has no backoff, right that this is an asymmetry, and right that the rule is reachable. Every one of those survives my measurement. My numbers come from a **GitHub** estate under an unusual load — four worker loops, three monitors, **two supervisors** (pid 8411 from the checkout and pid 27932 from the plugin cache at 2.21.0, 17 hours old) and 2291/hr of bitbucket traffic from other work. **The incident was reported from a Bitbucket estate I cannot see.** There, `PR_REQUESTS_PER_REFRESH` is 4 rather than 1 and the population may be genuinely different; a supervisor could be a much larger fraction of a much smaller total. The plan's own Notes admit this — *"Nobody has watched a Bitbucket supervisor under a live 429"* — which is more honest than most of what I checked.

**Why I still do not reach `proceed`.** That admission is precisely the problem: the plan names the gap and then builds as though it were closed. It asserts the supervisor is the spender without counting, and the one estate anybody *can* count says it is 4.5–9%. A backoff whose cost is an 8-minute hand-over cadence is not a change to make on an unmeasured premise.

**Why not `reject`.** The direction is right and the restraint is real. What it needs is a measurement it can get: an hour of `spend-rate` on the reporting estate, attributing the 429 before adding a controller to whatever it finds. If the supervisor is 60% of that account, this plan is correct as written and I would say so.

## What I would amend

1. **Measure before building.** The slice's first act is an hour of the budget record on the estate that reported the 429, attributing spend per connector and bucket. The plan already has the instrument — `plot-host.sh spend-rate` — and never uses it. If the supervisor is under ~20% of its pool, the fix belongs on the real spender and this plan should be withdrawn rather than built.
2. **Count what holding costs, and cap the stretch separately.** The supervisor's stretch is not the board's: the board renders stale, the supervisor stops working. A `MAX_CADENCE_STRETCH` of 8 is 8 minutes between hand-overs, against a reported incident of 20 minutes twice in two hours. Justify a supervisor-specific ceiling (2–3×) with that arithmetic, or say why 8 is right for a consumer whose spend *is* its purpose.
3. **Settle the statelessness question with #1041, not around it.** `cadenceStretch` needs `currentIntervalMs` to damp. A stateless daemon cannot supply it and single-steps to 2.75× forever. Two features now need cross-tick state; answer it once.
4. **Drop the naming "Done when" and record the answer.** `boardSharePerHour` models any fixed-interval consumer. Nothing to rename. Replace that bullet with the one the plan is missing: **the supervisor's calls are already in the record** (`plot-host.sh:2621`), so it is already in the board's `others` — the gap is reaction, not instrumentation.
5. **Name the reporting blast radius, and prefer the tick line.** A sixth `QueueHold` touches the union, the tested order, the total `HOLD_SCOPE`, and two test files. A deferred question is still `merge-unknown`; what is new is why the tick did not ask, and that belongs beside `cost=`.
6. **Fix the empty-argument `pr-merged` first.** Measured here as one of the tick's two calls. It halves the supervisor's spend with none of this machinery, and it may be #1059.

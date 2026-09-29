# A daemon spends within its means

> The board and the supervisor poll the same host on the same 60 s cadence. The board records what it spends, bounds its concurrency and stretches its interval under pressure. The supervisor does none of it, so when the host says stop, one of them listens.

## Status

- **State:** Approved
- **Approved:** 2026-09-29, jwloka, in-session
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1065
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1

## Changelog

- The supervisor backs off when the host rate-limits it, instead of asking again every 60 seconds.

Board impact: none directly — this is the daemon. Less contention for the account the board shares.

## Motivation

Reported from a Bitbucket estate: **`HTTP 429` twice in two hours**, every slice held `merge-unknown`, roughly twenty minutes of no work each time.

### What the measurement ruled out

A panel instrumented a real tick with a counting `plot-host.sh`: **4 host calls on 321 slices and 2 agents.** The per-branch readings are bounded — `queuedHasLanded` is gated on `claimable && briefPresent` and fired zero times. So the incident is **not** unbounded fan-out, and #1059 (now scoped to a genuine duplicate call) is not its cause either.

**Four calls a minute is not much. Four calls a minute that never slow down is the incident.**

### THE DIAGNOSIS WAS WRONG, AND THE ARITHMETIC REFUTES IT

An earlier draft blamed the supervisor. **Measured on the live account, and independently re-measured by the moderator:**

```
total last 60 min: 2825 requests
   bitbucket api    2497/hr   88%
   github  graphql   284/hr   10%   <- the supervisor's own pool
   jenkins            42/hr
   github  core        2/hr
```

An instrumented tick makes **two** host calls, not four — **120 req/hr at a 60 s tick, ceiling.** So the supervisor is **at most ~8% of the account** and a fraction of the Bitbucket traffic that caused the reported 429.

**The competition an earlier draft described runs ten times the other way.**

### THE BOARD IS ALREADY PAST ITS CEILING

The finding no amount of reading would have produced. Live, `/api/fleet`:

```
prAgeSeconds 511, prNextInSeconds 0  ->  interval 511s  ->  stretch 8.52
MAX_CADENCE_STRETCH = 8
```

Against `PR_REFRESH_MS = 60_000`. **The board is not throttling gracefully — it is pinned past its hard ceiling**, because `targetStretch` returns the maximum outright when `others >= share` (310/hr against a share of 60).

`cadence.ts:34-48` says what that means, and an earlier draft quoted none of it:

> **IT BOUNDS THE STRETCH, NOT THE SPEND.** An account genuinely spending eight times one board's share will exceed its budget … this rule divides a cadence, it does not enforce a quota.

**So adding a second consumer to that division removes ~5% of the load from an account already saturated.** The 429 does not stop.

### The supervisor is already IN the denominator

An earlier draft called this an instrumentation gap. It is not. `plot-host.sh:2621` — *"EVERY HOST CALL APPENDS ONE LINE, AND SO DOES EVERY REFUSAL"* — and the supervisor reaches the host through `host-shell.ts` → `plot-host.sh`. **Its calls are already in the record**, already inside the rate the board divides by, already pushing the board toward its ceiling. `prSpenders` counts them.

**The gap is in the reaction, not the measurement** — and reacting subtracts a consumer that is not the problem.

### The rule is already in the domain

`rules/cadence.ts` exports `boardSharePerHour`, `othersPerHour`, `targetStretch` and `cadenceStretch`. **It is domain-side, synchronous and takes readings as values** — so it is reachable from the supervisor without a port, an adapter or an HTTP hop.

Its name says `board`, and that is a naming question the slice must answer rather than work around.

## Design

### The rule, narrowed after round 1

**A tick REPORTS what the account is spending and what its own share of it is. It does not stretch.**

An earlier draft proposed a stretching cadence. The measurement killed it: the supervisor is ~8% of the account, the board is already past its ceiling at 8.52×, and a stretched supervisor pins at eight-minute hand-overs **permanently** to remove 5% of a load it did not create.

**What survives is the observability half.** The supervisor is in the spend record and reads none of it, so nobody could tell from a tick that the account was saturated — which is why the incident was diagnosed three times before it was measured. A tick that printed `account 2825/hr, mine 120/hr, board stretched 8.5×` would have settled it in one line.

**This is a smaller plan than the one that was written, and the narrowing is the finding.**

### BACKING OFF COSTS MORE THAN THE INCIDENT, AND THIS IS WHY THE PLAN NARROWED

An earlier draft asserted holding is safe because it is what silence already does, and never counted it. **Counted:**

`queue.ts:116-124` is where the safety argument actually rests:

> an unreachable host costs this pass its hand-overs and **the next tick re-asks**.

**A hold costs 60 seconds because the next tick is 60 seconds away.** A deliberate stretch breaks exactly that clause: at `MAX_CADENCE_STRETCH = 8` the next tick is **eight minutes** away.

| | cost |
|---|---|
| the reported incident | 429 twice in two hours, ~20 min each — **40 min lost in 120** |
| a stretched supervisor here | `others` (310/hr) exceeds `share` (60) **continuously**, so it pins at the ceiling and stays — **an 8-minute hand-over cadence all day** |

**Backing off converts an intermittent 20-minute outage into a permanent 8-minute one.**

And the feedback loop closes harder on the supervisor than on the board. `cadence.ts:11-20`: *"a board that has stopped asking has stopped spending, so a board pushed past an hour has no reading of its own fresh enough to bring it back."* A board at the ceiling still renders a stale page. **A supervisor at the ceiling is a fleet that hands over once every eight minutes** — its spend and its entire purpose are the same calls.

### The naming question is answered: rename nothing

`boardSharePerHour` (`cadence.ts:71`) is arithmetic over an interval and a cost and names a consumer nowhere; `othersPerHour` (`:101`) subtracts a consumer's derived contribution from an observed total. **Neither is board-specific**, and a reporting supervisor does not need them renamed.

**Convergence was also answered, and against the earlier draft.** `CADENCE_DAMPING = 0.25` was measured so that *"one through eight boards all settle at exactly 60.0"* — two stretching consumers converge rather than oscillate. But **only where the account has headroom.** Here `others >= share` sends both to the ceiling by `cadence.ts:143`, so they converge on both being maximally slow while 88% of the traffic carries on — filed as **#1069**.

### What this does NOT do

- **It does not change the tick interval's default.** 60 s stays; stretching is a response to pressure, not a new baseline.
- **It does not promote on silence.**
- **It does not fix #1059's duplicate call.** That is a separate, real defect and this plan is not its excuse.
- **It does not add a `PrIndexStore` read to the supervisor**, which is a larger change with its own layering argument.
- **It does not touch the board**, whose behaviour here is the model.

## Done when

- **A tick reports the account's observed rate, its own share, and the board's current stretch**, asserted against a stub spend record.
- **The tick interval is UNCHANGED**, asserted. This plan adds no backoff, and a later one may not add it without re-measuring who spends.
- **The report distinguishes a saturated account from an unreachable host.** `merge-unknown=N` means *the host would not answer*; *the account is at 2825/hr* is a different fact and an operator must not read one as the other.
- **The counters keep their shape**, so a tick remains comparable with an earlier one and anything parsing the `summary:` line is unaffected.
- **No cross-tick state is added.** The spend record is already on disk and read per tick; `DESIGN-agent.md`'s *holds nothing between ticks* survives intact, which the stretching version could not have promised.

## Slices

### A daemon spends within its means (Branch: bug/a-daemon-spends-within-its-means)

Read the account's spend rate in the tick and report it beside the supervisor's own share. Add no backoff.

## Notes

**Found by a panel juror interrogating #1059, by instrumenting a tick rather than reading one.** The plan it was judging blamed unbundled per-branch calls; the measurement refuted that and produced this instead.

**Split out deliberately.** A slice that fixed #1059's duplicate call and claimed the rate-limit incident would be the last time anybody checked — and the duplicate is 2 calls out of 4, which halves a number that was never the problem.

**Nobody has watched a Bitbucket supervisor under a live 429.** The incident report describes the symptom; the absence of backoff is read from source on a GitHub checkout. The slice should say which of the two it verified.


### Round 1, 2026-09-29

One juror, **amend**, **executed** — it measured the live account, replayed the cadence arithmetic, and ran two instrumented ticks. The moderator re-measured the account independently and confirmed the shape.

**The diagnosis was wrong.** 2825 req/hr on this machine, **88% of it Bitbucket**; the supervisor's own pool is 284/hr and its measured ceiling is 120. It is ~8% of the account, not the unthrottled spender this plan described.

**The board is past its ceiling** — 8.52× against `MAX_CADENCE_STRETCH = 8`, verified live and worse than when the juror measured 7.25×. Adding a second consumer to that division removes 5% of a load it did not create. The load itself is **#1069**.

**And backing off would cost more than the incident:** `others` exceeds `share` continuously here, so a stretching supervisor pins at eight-minute hand-overs permanently, against the incident's two twenty-minute windows.

**So the plan narrowed to its observability half**, which is the part the evidence supports: the supervisor is already in the spend record and reads none of it, which is why this incident was diagnosed three times before anyone measured it.

**What the juror upheld:** the refusal to promote on silence, the refusal to touch the board, and the refusal to claim #1059's fix — *"better discipline than the fourteen plans behind it"*.
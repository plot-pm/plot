# A daemon spends within its means

> The board and the supervisor poll the same host on the same 60 s cadence. The board records what it spends, bounds its concurrency and stretches its interval under pressure. The supervisor does none of it, so when the host says stop, one of them listens.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1065
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

## Changelog

- The supervisor backs off when the host rate-limits it, instead of asking again every 60 seconds.

Board impact: none directly — this is the daemon. Less contention for the account the board shares.

## Motivation

Reported from a Bitbucket estate: **`HTTP 429` twice in two hours**, every slice held `merge-unknown`, roughly twenty minutes of no work each time.

### What the measurement ruled out

A panel instrumented a real tick with a counting `plot-host.sh`: **4 host calls on 321 slices and 2 agents.** The per-branch readings are bounded — `queuedHasLanded` is gated on `claimable && briefPresent` and fired zero times. So the incident is **not** unbounded fan-out, and #1059 (now scoped to a genuine duplicate call) is not its cause either.

**Four calls a minute is not much. Four calls a minute that never slow down is the incident.**

### The asymmetry, measured

| | board | supervisor |
|---|---|---|
| spend rate read | `spendRateFor` (`fleet.ts:1870`) | **none** |
| concurrency bound | `withHostSlot` (`fleet.ts:1983`) | **none** |
| cadence stretches | `rules/cadence.ts` — `cadenceStretch`, `MAX_CADENCE_STRETCH`, `CADENCE_DAMPING` | **none** |

`grep -c 'withHostSlot\|recordSpend\|spendRate\|cadence'` over `registryd-main.ts` and `supervisor.ts`: **one hit, and it is a prose comment.** No machinery.

So under a 429 the board throttles and the daemon keeps asking at a fixed interval — **on the same account, competing with the consumer that is behaving.**

### The rule is already in the domain

`rules/cadence.ts` exports `boardSharePerHour`, `othersPerHour`, `targetStretch` and `cadenceStretch`. **It is domain-side, synchronous and takes readings as values** — so it is reachable from the supervisor without a port, an adapter or an HTTP hop.

Its name says `board`, and that is a naming question the slice must answer rather than work around.

## Design

### The rule

**A tick that cannot afford its host questions defers them and says so.**

Two properties, and the second is what makes the first safe:

1. **The interval stretches** when the account is under pressure, following `cadenceStretch` rather than a second implementation of it.
2. **A deferred question holds the slice**, exactly as an unreadable one does today. This plan changes how often the supervisor asks, never what it concludes from silence.

### Holding is already right and must stay

`queue-reading.ts` states it: *"SILENCE LEAVES THE SLICE BLOCKED … Promoting on silence would hand an agent a slice whose predecessor may still be running."* **Backing off makes silence more common, so the property it relies on has to be asserted rather than assumed.**

### What the slice must decide, with an argument

- **Whether the two consumers share a budget or hold separate ones.** They are separate processes with separate lifetimes on one account. `boardSharePerHour`'s name suggests the rule already contemplates several consumers; `othersPerHour` suggests it models them. **The slice reads those two functions before choosing** — this is not deferred judgement, it is two functions to open.
- **What the tick reports while throttled.** `merge-unknown=N` currently means *the host would not answer*. A deliberately deferred question must be distinguishable from a failed one, or an operator watching a backoff sees an outage.

### What this does NOT do

- **It does not change the tick interval's default.** 60 s stays; stretching is a response to pressure, not a new baseline.
- **It does not promote on silence.**
- **It does not fix #1059's duplicate call.** That is a separate, real defect and this plan is not its excuse.
- **It does not add a `PrIndexStore` read to the supervisor**, which is a larger change with its own layering argument.
- **It does not touch the board**, whose behaviour here is the model.

## Done when

- **A supervisor that is rate-limited asks less often**, asserted with a stub host returning 429 and a tick loop observed over several passes — not a claim in the PR body.
- **A deferred question holds its slice**, asserted. The one property a backoff must not cost.
- **The cadence rule is asked, not reimplemented**, asserted by there being no second stretch computation in the daemon.
- **A throttled tick is distinguishable from an outage in what it prints.**
- **The default interval is unchanged with an unpressured host**, asserted — every existing installation depends on it.
- **The naming question is settled in the PR**: `boardSharePerHour` is either renamed, or the plan records why a supervisor asking a function called *board* is acceptable.

## Slices

### A daemon spends within its means (Branch: bug/a-daemon-spends-within-its-means)

Read the account's spend rate in the tick, stretch the interval through `cadenceStretch`, and hold every question the budget defers.

## Notes

**Found by a panel juror interrogating #1059, by instrumenting a tick rather than reading one.** The plan it was judging blamed unbundled per-branch calls; the measurement refuted that and produced this instead.

**Split out deliberately.** A slice that fixed #1059's duplicate call and claimed the rate-limit incident would be the last time anybody checked — and the duplicate is 2 calls out of 4, which halves a number that was never the problem.

**Nobody has watched a Bitbucket supervisor under a live 429.** The incident report describes the symptom; the absence of backoff is read from source on a GitHub checkout. The slice should say which of the two it verified.

# Panel — a daemon spends within its means (#1065)

Subject: `docs/plans/2026-09-29-a-daemon-spends-within-its-means.md`
Round 1, 2026-09-29. One juror, both commitments gated.

| Juror | Position | Evidence |
|---|---|---|
| consequence | amend | executed |

**The plan blamed the wrong process, and the juror measured the account to prove it.** Two instrumented ticks, the live spend record, and a replay of the cadence arithmetic. The moderator re-measured the account independently and confirmed the shape.

## THE DIAGNOSIS IS WRONG

```
total last 60 min: 2825 req/hr
  bitbucket api   2497   88%
  github graphql   284   10%   <- the supervisor's pool
```

An instrumented tick makes **two** host calls — 120 req/hr at 60 s. **The supervisor is ~8% of the account and a third of its own pool.** The plan's *"the board throttles and the daemon keeps asking … competing with the consumer that is behaving"* describes a competition running ten times the other way.

## THE BOARD IS ALREADY PAST ITS CEILING

The finding no reading would have produced. Live `/api/fleet`: interval **511 s** against `PR_REFRESH_MS = 60_000` — a stretch of **8.52** against `MAX_CADENCE_STRETCH = 8`. Verified by the moderator, and **worse than the juror's 7.25×** an hour earlier.

`targetStretch` returns the maximum outright when `others >= share` (`cadence.ts:143`). And `cadence.ts:34-48`:

> **IT BOUNDS THE STRETCH, NOT THE SPEND.** An account genuinely spending eight times one board's share will exceed its budget … this rule divides a cadence, it does not enforce a quota.

**Adding a second consumer to a saturated division removes 5% of a load it did not create.** The 429 does not stop.

## BACKING OFF COSTS MORE THAN THE INCIDENT

The safety argument rests on `queue.ts:116-124` — *"an unreachable host costs this pass its hand-overs and **the next tick re-asks**"*. A hold costs 60 s **because the next tick is 60 s away.** A stretch breaks that clause.

| | cost |
|---|---|
| the incident | 429 twice in two hours — 40 min lost in 120 |
| a stretched supervisor here | `others` exceeds `share` **continuously** — 8-minute hand-overs all day |

**An intermittent 20-minute outage becomes a permanent 8-minute one.** And the feedback loop closes harder on the daemon: a board at the ceiling renders a stale page; **a supervisor at the ceiling is a fleet that hands over once every eight minutes**, because its spend and its purpose are the same calls.

## THE SUPERVISOR IS ALREADY IN THE DENOMINATOR

The plan called this an instrumentation gap. `plot-host.sh:2621` — *"EVERY HOST CALL APPENDS ONE LINE"* — and the supervisor reaches the host through it. **Its calls are already in the record, already inside the rate the board divides by.** The gap is in the *reaction*, not the measurement.

## Convergence, answered

`CADENCE_DAMPING = 0.25` was measured so *"one through eight boards all settle at exactly 60.0"* — two consumers converge rather than oscillate. **But only with headroom.** Here `others >= share` sends both to the ceiling, and they converge on both being maximally slow.

Rename nothing: `boardSharePerHour` and `othersPerHour` are arithmetic and name no consumer.

## What the juror upheld

The refusal to promote on silence, the refusal to touch the board, the refusal to claim #1059's fix — *"better discipline than the fourteen plans behind it"*.

## Disposition

**The plan narrowed to its observability half**, which the evidence supports: the supervisor is in the spend record and reads none of it, which is why this incident was diagnosed three times before anyone measured it. A tick printing `account 2825/hr, mine 120/hr, board stretched 8.5×` settles it in a line.

**The 88% is filed as #1069** — two plans have now blamed the wrong consumer, and the traffic that actually saturates the account is unowned.

# Juror: cadence behaviour

Lens: what the polling actually DOES once a ceiling is fed in. I read `packages/domain/src/rules/cadence.ts` whole, traced both refresh sites, and simulated three plausible implementations of the plan's one sentence — *"pass it into `refreshIntervalMs` beside the observed rate"* — against the real constants.

## 1. Are the plan's factual claims true on main?

**Verified true:**

- `prRefreshMsFor` is at `packages/board/src/server/fleet.ts:1724`, is called at both refresh sites (`fleet.ts:2006` via `prNextDueAt`, `fleet.ts:2410` via `scheduleNextPr`), and delegates to `refreshIntervalMs` holding no second copy of the arithmetic (`fleet.ts:1729`).
- `refreshIntervalMs` is at `cadence.ts:244` and takes exactly four parameters, the third being `rate: Pick<SpendRate, 'perHour'> | null`. **One field, no ceiling** — correct.
- `MAX_CADENCE_STRETCH = 8` (`cadence.ts:32`), `CADENCE_DAMPING = 0.25` (`cadence.ts:59`).
- `cadence.ts:15-19` does document the feedback loop the plan cites: *"a board that has stopped asking has stopped spending, so a board pushed past an hour has no reading of its own fresh enough to bring it back."*
- Cost per refresh varies per connector: `PR_REQUESTS_PER_REFRESH` at `fleet.ts:184` — `github: 1`, `bitbucket: 4`, default 1 (`fleet.ts:1909`).
- `spend-rate` reads the local record and asks no host (`plot-host.sh:3781-3836`, delegating to `budget_rate` at `plot-budget.sh:224`, which is one `awk` pass over a file).
- Jenkins `limit: 60` is hardcoded — but at **`plot-host.sh:3760`** it is the `ci-limit` op, and the line is `{"connector":"jenkins",...,"limit":60,...,"basis":"predicted"}`. The plan's line number is right; its characterisation as a bare default understates that it is already correctly tagged `predicted`.
- `plot-host.sh:1648` is `budget_record_jira`, appending `- - -` with basis `unknown`. Correct.
- The live measurement reproduces. Run just now:
  `{"connector":"github","account":"jwloka","bucket":"","spent":1157,"spanMs":3566800,"perHour":1167.77,"lines":72829,"unreadable":0,"limit":null,"remaining":null,"resetAt":null,"basis":"unknown"}`
  The plan quotes `perHour: 157.09`; today it reads 1167.77. Both show `limit: null, basis: unknown`, which is the claim that matters.

**FALSE, and it is the plan's central table.** The row *"Bitbucket | no limit headers | rate only"* is wrong on main:

```
plot-host.sh:3733  echo '{"connector":"bitbucket","bucket":"api","limit":1000,
                          "remaining":null,"reset":null,"basis":"predicted"}'
```

Bitbucket **already declares a ceiling of 1000/hr**, tagged `predicted`, with the adapter comment stating exactly the plan's own reasoning: *"the number is this adapter's, from experience — 1000 requests/hour for an authenticated account — and it is tagged `predicted` because that is what it is."* The plan's Notes say Bitbucket's *"limit is unreportable, so a fair-share stretch against observed spend is the only signal the board has there today."* That is false. So is the table row for Jenkins, whose `predicted: 60` is the same mechanism.

**UNSTATED, and it changes the shape of the plan.** A declared ceiling **already has a live consumer on main**. `spendRateFor` (`fleet.ts:1754-1796`) reads `limit`, `basis` and `account` out of the same `spend-rate` JSON, stores them at `fleet.ts:2461-2463`, and `prConcurrencyBound` (`fleet.ts:1643`) feeds them to `concurrencyBound(boundFromLimit(limitReadingOf(entry)), entry.prConcurrency)` — `rules/concurrency.ts:145,168`. `boundFromLimit` converts an hourly limit into a simultaneous-call bound and explicitly returns null for `basis === 'unknown'`.

That matters for two reasons. First, the estate already has an answer to *"how close am I to the wall?"* — it is spent on concurrency, not on cadence, and `concurrency.ts:105-128` argues at length that the two are different quantities and *"a bound cannot be READ off a limit."* The plan does not mention `boundFromLimit`, `concurrencyBound` or `prConcurrencyBound` once. Second, a new config key feeding a ceiling into the cadence would feed the *same* value into the concurrency bound through the same `limitReadingOf`, silently changing a second rule the plan never names.

**The real gap, which the plan misidentifies.** `budget_rate` (`plot-budget.sh:277-283`) only reports a limit from *"the newest live line that carries a reading"* whose basis is not `unknown`, and drops it entirely where the basis is `unknown`. So the ceiling exists at `plot-host.sh limit` / `ci-limit` (`5000 actual` for GitHub here, `1000 predicted` for Bitbucket, `60 predicted` for Jenkins) and does not reach `spend-rate` because ordinary `pr-list` calls write `unknown` lines. Measured side by side, just now:

```
plot-host.sh limit       → {"limit":5000,"basis":"actual"}
plot-host.sh spend-rate  → {"limit":null,"basis":"unknown"}
```

**The ceiling is already declared. It is the plumbing between two ops of one script that drops it.** That is a smaller and different change from a new config key.

## 2. Is the problem real, and is the shape right?

**First half of the plan's claim — "built, wired and working" — is TRUE.** The cadence is live at both sites and demonstrably divides.

**Second half — "blind in exactly one direction" — is FALSE in the way that decides this.** The board is not blind to the ceiling; it reads it and spends it on the concurrency bound. What it lacks is the ceiling arriving through `spend-rate`, and a cadence rule that would use it.

## 3. What the polling actually does with a ceiling — the lens

I simulated the real constants (`PR_REFRESH_MS = 60000`, cost 1/gh and 4/bb, damping 0.25, max stretch 8) against three readings of *"pass it in beside the rate"*. Every number below is from a 400-800 step run to settling.

**Baseline on main.** One board alone settles at exactly its unstretched interval and its designed share, both hosts:

```
gh  1 board alone          60000 ms   → 60.0 req/hr
bb  1 board alone         240000 ms   → 60.0 req/hr
gh  + 100/hr external     480000 ms   →  7.5 req/hr   (at MAX_CADENCE_STRETCH)
gh  live 1167.77/hr       480000 ms   →  7.5 req/hr   (at MAX_CADENCE_STRETCH)
```

**Note the last line.** On this estate *right now*, with the account observed at 1167/hr, the GitHub board is already pinned at the maximum stretch — 8 minutes between refreshes, 7.5 req/hr. **The cadence is saturated before any ceiling is added.** A second input cannot make it slower; `Math.min(MAX_CADENCE_STRETCH, ...)` at `cadence.ts:144` and `:208` caps it. So for the one connector where the plan measured, the change is provably inert today.

**Variant A — the ceiling replaces the 60/hr share** (the most literal reading of *"the board is entitled to `share - others`"*, with share taken from the ceiling):

```
bb ceiling=1000, alone     240000 ms  → 60.0/hr
bb ceiling= 100, alone     240000 ms  → 60.0/hr
bb ceiling=  60, alone     240000 ms  → 60.0/hr
bb ceiling=  30, alone     240000 ms  → 60.0/hr    ← board spends 60 against a ceiling of 30
bb ceiling=  10, alone     240000 ms  → 60.0/hr    ← 6x over its declared ceiling
```

**The ceiling is inert in exactly the case it was declared for.** `targetStretch` (`cadence.ts:143-146`) floors the quotient at 1 by construction — *"a board may only ever be slowed down"* — so with `others = 0` the target is 1 whatever the share is, and a ceiling below the board's own spend changes nothing. An operator who declares `Rate ceiling: bitbucket 10` and watches the board keep spending 60/hr has a config key that reads as broken.

Where the ceiling does bite in Variant A, it does so as a cliff:

```
bb ceiling=1000, +200/hr external   300000 ms → 48.0/hr
bb ceiling= 100, +200/hr external  1920000 ms →  7.5/hr   ← straight to MAX
bb ceiling=  60, +200/hr external  1920000 ms →  7.5/hr
jen ceiling=60, +50/hr external     360000 ms → 10.0/hr
jen ceiling=60, +59/hr external     480000 ms →  7.5/hr   ← MAX
jen ceiling=60, +61/hr external     480000 ms →  7.5/hr   ← MAX
```

A 2-request difference in observed external spend (59 vs 61 against a ceiling of 60) moves the board from *near the wall* to *pinned at maximum*, and past the wall there is no further signal — every ceiling from 100 down to 1 produces the identical 1920000 ms. **The rule collapses to `MAX_CADENCE_STRETCH` and stops being responsive**, which is the `others >= share` branch at `cadence.ts:140`. Beyond that point the declared number carries no information.

**Variant B — the ceiling floors this board's own stretch** (`stretch >= ownBaseSpend / ceiling`):

```
bb ceiling=1000, alone   240000 ms → 60.0/hr
bb ceiling=  60, alone   240000 ms → 60.0/hr
bb ceiling=  30, alone   480000 ms → 30.0/hr   ← honoured
bb ceiling=  10, alone  1440000 ms → 10.0/hr   ← honoured
bb ceiling= 7.5, alone  1920000 ms →  7.5/hr   ← at MAX
bb ceiling=   1, alone  1920000 ms →  7.5/hr   ← 7.5x over, silently
```

This is the only variant that honours a declared ceiling, and it is a **gate in behaviour**: the board's spend is capped by a declared number rather than informed by it. The plan says at line 93 *"A ceiling makes the stretch better informed; it never becomes a gate."* Variant B contradicts that sentence; Variants A and C honour it and produce no useful behaviour. **The plan's stated constraint and its stated goal are in tension, and nothing in the plan resolves it.** Note also the last row: a ceiling below 7.5/hr is silently unenforceable because `MAX_CADENCE_STRETCH` caps the stretch at 8, and nothing on main reports that saturation — `grep MAX_CADENCE_STRETCH` over `packages/` returns only `cadence.ts` itself.

**Variant C — headroom = ceiling − observed spend**, the reading closest to *"how close am I to the wall?"*:

```
bb ceil=1000, alone       240000 ms → 60.0/hr
bb ceil= 100, alone       288001 / 287999 ms alternating → 50.0/hr
bb ceil=  60, alone       480002 / 479998 ms alternating → 30.0/hr
bb ceil=  61, alone       472133 / 472129 ms alternating → 30.5/hr
bb ceil=  70, alone       411427 / 411430 ms alternating → 35.0/hr
jen ceil= 60, +30/hr ext  239998 / 240002 ms alternating → 15.0/hr
```

**It oscillates, permanently, in five of six cases.** The board never settles; it alternates between two intervals a few milliseconds apart forever. The cause is precise and is documented in the file the plan says it will not change: the snap at `cadence.ts:211` fires when the remaining step is worth under a millisecond of interval and jumps to the target — but under Variant C the target is a function of a rate that is itself a function of the interval, so snapping onto the target moves the target, and the next pass snaps back. `CADENCE_DAMPING` cannot damp it because the snap bypasses the damping. The 30-step trace for `ceil=70` shows it converging cleanly (540s → 488 → 455 → 435 → 424 → 418 → 415 → 413 → 412 → 411) and then never coming to rest.

The amplitude here is 3-4 ms, so it is harmless in practice — but it is a limit cycle the file explicitly reasons about avoiding (`cadence.ts:203-206`: *"rounding the interval instead quantises the step into a one-millisecond limit cycle around the same place"*), and its existence means the second input interacts with the snap in a way the plan asserts it will not.

**Direct answers to the lens questions:**

- *Near the limit vs far from it*: far from it, nothing changes — every variant returns the unstretched interval for a board alone under a generous ceiling. Near it, Variant A jumps to `MAX_CADENCE_STRETCH` across a 2-request threshold and Variant C oscillates.
- *As spend approaches the ceiling*: the response is not graduated. `targetStretch`'s `others >= share → MAX_CADENCE_STRETCH` branch (`cadence.ts:140`) means the approach is a step, not a ramp.
- *Can it collapse to maximum stretch*: yes, and on this estate it **already has** — GitHub at 1167/hr observed is pinned at 480000 ms today, before any ceiling exists.
- *Can it stop being responsive*: yes. Past the wall every ceiling value produces the identical interval, so the declared number stops carrying information exactly where it was supposed to start.
- *Does the mechanism honour "never a gate"*: no variant does both. The variants that honour it do nothing; the variant that does something is a cap on spend.

## 4. What `Done when` fails to pin

The list is: a declared ceiling reaches `refreshIntervalMs`; a real limit is preferred; a connector with neither is byte-identical; keyed by connector and account; no new host call; the two constants unchanged; tests pass.

**An implementation can satisfy every one of those and change no board's behaviour at all.** Variant A passes the entire list — a ceiling reaches the function, a real limit is preferred, the no-ceiling case is byte-identical, nothing new is called, both constants stand — and produces the identical 240000 ms for every ceiling from 1000 down to 10 on a board alone. The gate *"a declared ceiling reaches `refreshIntervalMs`"* tests plumbing, not effect. **Nothing in the list asserts that any interval differs from today's for any input.** That is the specific way this could ship green and be worthless, and it is the same failure mode as the rejected sibling: a chain connected for its own sake.

Three more things unpinned:

- **The concurrency bound.** A ceiling arriving through `spend-rate` also reaches `boundFromLimit` via `limitReadingOf` (`fleet.ts:1619-1628`). A declared `Rate ceiling: bitbucket 1000` would propose a concurrency bound of `floor(1000/900) = 1` — `MIN_CONCURRENCY` — serialising every Bitbucket call on that board. Nothing in `Done when` pins the concurrency bound as unchanged, and this is a real regression the plan cannot see because it never names the rule.
- **Saturation.** No gate requires the board to say it is at `MAX_CADENCE_STRETCH`. A ceiling the stretch cannot honour (below 7.5/hr on GitHub) is silently exceeded.
- **Convergence.** No gate requires the interval to settle. Variant C oscillates forever and passes.

## 5. The strongest argument against doing this at all

**The ceiling is already declared, and the plan proposes to declare it a second time.** `plot-host.sh` answers `limit: 5000 actual` for GitHub, `1000 predicted` for Bitbucket, `60 predicted` for Jenkins — the exact three numbers the plan's table says are missing. Adding a `## Plot Config` key creates a second source for one fact, and CLAUDE.md's own reconcile-scan sections exist precisely because *"two records of one fact, and nothing read the pair"* is this estate's recurring defect. The honest reading is that `budget_rate` drops the limit whenever the newest line's basis is `unknown` (`plot-budget.sh:281-283`), so the ceiling never reaches the one op the board asks. That is a plumbing fix inside one script, not a new config key, and it would deliver the plan's stated benefit for all three connectors without inventing a declaration.

Second, subordinate: even with the ceiling delivered, the cadence rule has nowhere useful to put it. The measurements above show every faithful-to-the-plan use of it is either inert or a gate, and the estate's own reasoning (`concurrency.ts:105-128`) already argues that an hourly limit is the wrong quantity to read a per-moment decision off. The ceiling's existing consumer — the concurrency bound — is where it belongs and where it already is.

## What I could not verify

- Whether `perHour: 157.09` was accurate on 2026-09-15; I reproduce the same shape at 1167.77 and the `limit: null` claim holds.
- The operator's `bb` report. This repository is on GitHub, so no Bitbucket cadence can be observed here; I simulated it from the real constants instead.
- Whether the plan's author intends Variant A, B or C. The plan says only *"passed into the same rule"*. I tested all three rather than assume one, and none is both effective and non-gating.

## Recommendation

Amend rather than reject. The finding underneath is real — the board's cadence does not see a ceiling — but the plan's diagnosis, its table and its shape are all wrong. An amended plan should: correct the table (Bitbucket and Jenkins already declare `predicted` ceilings); name `budget_rate`'s `unknown`-basis drop at `plot-budget.sh:281-283` as the actual break; name `boundFromLimit`/`prConcurrencyBound` as the ceiling's existing consumer and pin it unchanged; resolve the contradiction between *"never a gate"* and *"back off against the budget it actually has"*, stating which it wants; and replace the plumbing gates with one that asserts a **different interval for a given input**, since the current list is satisfiable by a no-op.

Verdict: amend

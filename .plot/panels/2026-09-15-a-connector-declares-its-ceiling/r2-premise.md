# Premise lens, round 2 — a connector declares its ceiling

Read on `origin/main` at `bc4d0023`. Traced the ceiling end to end: `plot-budget.sh`'s record → `budget_rate`'s window → `plot-host.sh spend-rate` → `spendRateFor` → `limitReadingOf` → `boundFromLimit`, and separately → `prRefreshMsFor` → `refreshIntervalMs`. Named below is what I read and ran, not what a name implied.

## The headline finding: the amendment's replacement measurement is ALSO false, and it is false in the direction that reverses round 1

Round 1 found the original plan's quoted reading false, and the amendment replaced it with this:

```json
{"connector":"github","account":"jwloka","spent":1083,"perHour":1085.72,
 "limit":5000,"remaining":3229,"resetAt":1789468250000,"basis":"actual"}
```

I ran `skills/plot/scripts/plot-host.sh spend-rate` three times in a row, just now, on this estate:

```json
{"connector":"github","account":"jwloka","bucket":"","spent":149,"spanMs":3592621,"perHour":149.31,"lines":73089,"unreadable":0,"limit":null,"remaining":null,"resetAt":null,"basis":"unknown"}
{"connector":"github","account":"jwloka","bucket":"","spent":149,...,"limit":null,"remaining":null,"resetAt":null,"basis":"unknown"}
{"connector":"github","account":"jwloka","bucket":"","spent":149,...,"limit":null,"remaining":null,"resetAt":null,"basis":"unknown"}
```

**`limit: null`, `basis: unknown`.** That is the ORIGINAL plan's reading — the one round 1 declared false and the amendment deleted as an error.

**Neither reading is an error. Both are correct, at different moments, and that is the actual finding.** I measured the record directly (`/Users/jwloka/.plot/state/budget.tsv`, 130,621 lines):

| connector | lines | basis |
|---|---|---|
| github | **73,048** | `unknown` |
| github | **42** | `actual` |
| bitbucket | 47,734 | `predicted` |
| jenkins | 7,940 | `unknown` |
| jira | 1,865 | `unknown` |

**GitHub reports `actual` on 42 lines out of 73,090 — 0.06%.** Over the last 2000 github lines: 1 `actual`, 1999 `unknown`. Over the last 200: zero.

The single `actual` line the amendment quotes is real and I found it:

```
b1  github  jwloka  graphql  1789467240021  1  5000  3229  1789468250000  actual
```

It is **101.9 minutes old**, and its `resetAt` (1789468250000) passed **85 minutes ago**. `budget_rate` reads over a window starting at the latest reset that has already passed (`plot-budget.sh:206-210`), so that line is outside the window now. It was inside it when the amender ran the command.

**So the amendment corrected a true reading into a rarer one and presented the rarer one as the standing state.** Round 1's moderator re-derived the number and caught the plan; nobody re-derived the correction. The plan now rests on a 0.06% sample, stated as fact, with no window or frequency named.

## Which consumers see the ceiling, and which do not — traced, not inferred

**The plan's central code reading is TRUE.** `refreshIntervalMs` (`cadence.ts:244`) takes `rate: Pick<SpendRate, 'perHour'> | null` (`cadence.ts:247`) — one field, no ceiling. Verified verbatim. `prRefreshMsFor` (`fleet.ts:1724`) passes exactly that. `MAX_CADENCE_STRETCH = 8` (`cadence.ts:32`), `CADENCE_DAMPING = 0.25` (`cadence.ts:57`) — both exact.

**The existing consumer is TRUE.** `limitReadingOf` (`fleet.ts:1619`) shapes `prLimit`/`prResetAt`/`prLimitBasis`; `boundFromLimit` (`concurrency.ts:139`) converts; `withHostSlot` enforces at `fleet.ts:2476`. All verified.

**`plot-host.sh:1984` is TRUE.** `bitbucket) printf '%s\t%s\t%s\t%s\n' 1000 - - predicted ;;` — exact line.

**But the trace shows the ceiling reaching the concurrency bound is conditional, and on GitHub it is almost always absent.** `boundFromLimit` returns `null` on `basis === 'unknown' || limit === null` (`concurrency.ts:139-140`). So on 99.94% of GitHub readings the concurrency bound is `null` — **unbounded**, not bounded. The amendment's sentence *"the board reads it and spends it on concurrency"* describes the 0.06% case.

I ran the rule on the four live readings:

| reading | `boundFromLimit` |
|---|---|
| github live (`null`/`unknown`) | **null — unbounded** |
| github rare (`5000`/`actual`) | 5 |
| bitbucket live (`1000`/`predicted`) | **1** |
| jenkins (`60`/`predicted`) | 1 |

## The reading round 1 asked for, and it changes the plan

Round 1's moderator wrote: *"The cheapest next step is a reading, not a branch... on the repository whose bb board polls too hard, run spend-rate. One command decides which plan to write."* That reading was never taken. **I took it** — this machine's record holds live Bitbucket traffic under account `quatico`:

```json
{"connector":"bitbucket","account":"quatico","bucket":"api","spent":771,
 "spanMs":3598122,"perHour":771.40,"lines":40112,
 "limit":1000,"remaining":null,"resetAt":null,"basis":"predicted"}
```

**Bitbucket is at 771/hr against its declared 1000 — 77% of ceiling, right now.** The operator's report that `bb` polls too hard is, for the first time, corroborated by an artefact on this estate. The plan's Notes still say *"no artefact on this estate records it"* and *"no Bitbucket cadence is observable here."* **Both sentences are false against this record.**

And the answer round 1 predicted is confirmed: `boundFromLimit({limit:1000, basis:'predicted'})` = `floor(1000/900)` = **1 = `MIN_CONCURRENCY`**. Bitbucket's host calls are **already serialised on this board, today, with no plan change at all.**

## 1. Every factual claim, verified

**TRUE:** `plot-host.sh:1984` (bitbucket 1000 predicted); `fleet.ts:1619` (`limitReadingOf`); `concurrency.ts:139` (`boundFromLimit`); `cadence.ts:244` and its one-field `rate`; `fleet.ts:1724` (`prRefreshMsFor`); `fleet.ts:2476` (`withHostSlot`); both constants; "spend-rate asks no host" (it reads `budget.tsv`); "the ceiling is an account property" (`BudgetKey.account`, and the bitbucket/github accounts differ live — `quatico` vs `jwloka`); "a probe spends the budget it is protecting."

**FALSE:** the replacement `spend-rate` output, as a standing reading (0.06% of github lines); the Notes' *"no artefact on this estate records it"* and *"no Bitbucket cadence is observable here"* (40,112 bitbucket lines at 771/hr).

**MISLEADING:** *"the board is not blind to the ceiling. It reads it and spends it on concurrency"* — true on 0.06% of GitHub readings, true on Bitbucket, and on Bitbucket the bound is already `MIN_CONCURRENCY`.

**The three-basis table is TRUE and the plan's own live evidence contradicts its use of it.** The table is accurate. But it presents `actual` as GitHub's normal state; the record says GitHub is `unknown` 99.94% of the time.

**Could not verify:** the operator's original report as a report. The rate is now corroborated; the complaint itself is still Notes-only.

## 2. Is the one-sentence gap true, and is it the whole gap?

**The sentence is true and it is not the whole gap.** *"The cadence does not read the ceiling the concurrency bound already reads"* — verified: `refreshIntervalMs` takes `perHour` alone.

Three things it omits:

**(a) It presupposes the concurrency bound reads a ceiling. On GitHub it reads `null` almost always.** The sentence implies a working reader the cadence merely lacks; on the plan's own headline connector, the reader is dark 99.94% of the time. The plan would plumb a ceiling into the cadence that, for GitHub, is `null` on all but 42 readings in 73,090.

**(b) Bitbucket needs no declaration at all.** It already answers `1000 predicted` on 100% of lines, live, from `plot-host.sh:1984`. The plan's deliverable is *"read an optional per-connector rate ceiling from `## Plot Config`"* — for the one connector whose cadence is the motivating complaint, that key adds nothing the shell does not already supply. The work is passing `limitReadingOf(entry)` where `rate` is passed, which needs no config key, no precedence rule, and no new vocabulary.

**(c) The cadence may already be doing what the plan wants, by a different route.** `targetStretch` (`cadence.ts:121-147`) already returns `MAX_CADENCE_STRETCH` when `others >= share`. At 771/hr on Bitbucket that branch is plausibly live. **No one has measured what interval the Bitbucket board is actually running at.** The plan proposes a second input to a rule whose current output on the complaining connector is unmeasured.

## 3. Does the new "an interval ACTUALLY MOVES" gate close round 1's hole?

**Partly. It closes the demonstrated variant and leaves the load-bearing one open.**

It does close `cadence`'s round-1 demonstration: a test asserting two different numbers for two ceilings refuses an implementation returning 240000 ms for every ceiling. That is a real improvement.

**What it does not pin:**

- **Direction and magnitude are unstated.** *"a connector near its ceiling polls measurably slower than the same connector far from it, pinned by a test asserting two different numbers."* Two different numbers is satisfied by a 1 ms difference, and by a difference in the **wrong direction** — the prose says "slower" but the gate says "two different numbers", and the gate is what a builder writes. `cadence.ts:143-147` documents that a board *"may only ever be slowed down"*; a ceiling input that speeds anything up violates that rule and passes this gate.
- **"near its ceiling" is undefined.** No percentage. The builder chooses inputs that differ, and any two work.
- **Convergence is now gated but the fixed point is not named.** *"pinned by iterating the rule to a fixed point"* — a rule converging to the unstretched interval for every ceiling converges, and is inert.
- **The saturation gate is unfalsifiable as written.** *"the board says when it is at `MAX_CADENCE_STRETCH`"* — says where? No surface named. `targetStretch:140` already returns `MAX_CADENCE_STRETCH`; whether anything renders it is a different question the gate does not ask.
- **The concurrency gate is right and understates the risk.** *"`boundFromLimit` returns unchanged for every one of those inputs"* is correctly added. But on Bitbucket the value it pins is **1** — already minimal. Pinning it unchanged pins a board that is already serialised, which is arguably the defect rather than the baseline.
- **Nothing pins the 0.06% case.** No gate asks what the cadence does when the ceiling is `null`/`unknown`, which is GitHub's standing state. The "byte-identical" gate covers "no ceiling configured"; it does not cover "ceiling configured, record reports `unknown`" — the common path.

## 4. The strongest argument against doing this at all

**The plan names the likelier root cause, declines it, and the evidence I took favours the one it declined.**

`plot-budget.sh:281-283` gates on `c_basis[i] != "unknown"`, so `budget_rate` reports the newest line **carrying a reading** rather than the newest line. The plan calls this *"a likelier root cause"* and does not adopt it, deferring to *"the reading that decides it."*

**I took that reading, and it decides against the plan as scoped:**

1. **The ceiling does reach the board on Bitbucket** — 100% of lines, `1000 predicted`, no plumbing defect. So `plot-budget.sh:281-283` is not dropping Bitbucket's limit either. **Both candidate root causes are wrong for the complaining connector.**
2. **The Bitbucket concurrency bound is already 1.** The board is already serialising Bitbucket host calls. If it still polls too hard, the cause is neither the ceiling nor the cadence input — it is somewhere nobody has looked, and a cadence change would be aimed at the wrong component.
3. **The config key is unnecessary for the motivating case.** Bitbucket declares 1000 in the shell. The plan's deliverable — an optional `## Plot Config` key with a three-way precedence — solves a problem the shell already solved, for the one connector that motivated it.

Against that: the plan's central code reading is genuinely correct, the gap is genuinely real, and the fix for the real gap is small — pass `limitReadingOf(entry)` alongside `rate`. **That work needs no config key.** The plan is now two things bundled: a one-line wiring that is justified, and a configuration vocabulary whose first named consumer does not need it.

Round 1 also found the config key sets a precedent no other key on this estate sets (a name varying by runtime data, two levels deep), and `plot-config.sh:141-165` prefix-matching plus unconditional exit 0 means a misspelt declaration is silent. **The amendment does not address that finding at all.** The plan still never says what the key is called.

## What an amended plan needs

1. **Replace the quoted reading with its frequency.** "GitHub reports `actual` on 42 of 73,090 recorded lines; the standing reading is `limit: null, basis: unknown`." The plan must state which case it is designed for.
2. **Record the Bitbucket measurement.** 771/hr against 1000, account `quatico`, 40,112 lines. It corroborates the motivating complaint and falsifies two Notes sentences.
3. **Split the slice.** Wiring `limitReadingOf(entry)` into `refreshIntervalMs` is justified and needs no config key. The declaration is a second question whose first consumer does not need it — and round 1's precedent finding is still unanswered.
4. **Measure the Bitbucket board's current interval before changing the rule.** `targetStretch` may already be returning `MAX_CADENCE_STRETCH` at 771/hr. Nobody has looked.
5. **Fix the "actually moves" gate to name direction and threshold** — "at 90% of ceiling the interval is strictly greater than at 10%", never "two different numbers".
6. **Gate the `unknown` path**, which is GitHub's standing state and which no current gate covers.

**Not a rejection.** The code reading at the plan's centre is correct, the gap is real, and the concurrency-regression gate the amendment added is a genuine improvement. But the amendment replaced one unrepresentative measurement with another, in the opposite direction, and the reading round 1 asked for — which I took — points at neither root cause the plan considers.

Verdict: amend

r2-premise: amend

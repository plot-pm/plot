# Panel — a-connector-declares-its-ceiling

Subject: `docs/plans/2026-09-15-a-connector-declares-its-ceiling.md` (Draft, uninterrogated)
Lenses: premise, cadence, declaration.
Reconciliation: **unanimous — amend**

## The unanimity is not the finding. This is:

**The plan's headline measurement is false, and the moderator re-derived it rather than accepting three agreements.**

Plan Design, quoted as live on 2026-09-15:

```json
{"connector":"github","perHour":157.09,"limit":null,"remaining":null,"basis":"unknown"}
```

Run now:

```json
{"connector":"github","account":"jwloka","spent":1083,"perHour":1085.72,
 "limit":5000,"remaining":3229,"resetAt":1789468250000,"basis":"actual"}
```

**`limit: 5000`, `basis: actual`.** The plan's sentence — *"157 calls an hour against a limit the record cannot state"* — is false on the one connector it is stated about. The record states it, and states what remains. The rate is also seven times the quoted figure, and the `account` field the plan's own Done-when demands is present.

## The subtitle is false, and so are two of three table rows

*"no connector but GitHub reports a limit"* — `plot-host.sh:1984`:

```
bitbucket) printf '%s\t%s\t%s\t%s\n' 1000 - - predicted ;;
```

**Bitbucket declares 1000/hr**, tagged `predicted`, with an adapter comment (`:1969`) giving the plan's own reasoning: *"the adapter's own number from experience."* Jenkins' `predicted: 60` is the same mechanism. The plan's table says both report nothing; both report a number.

So the Notes' claim — Bitbucket's *"limit is unreportable, so a fair-share stretch against observed spend is the only signal the board has today"* — is false, and it is the plan's motivating sentence.

## The decisive finding: the ceiling already has a consumer

Three lenses converged here from different directions, and it reframes the whole plan.

`limitReadingOf` (`fleet.ts:1619`) shapes `prLimit`/`prResetAt`/`prLimitBasis` into a `LimitReading`; `boundFromLimit` (`concurrency.ts:139`) converts an hourly ceiling into a **simultaneous-call bound**; `withHostSlot` enforces it around every host call (`fleet.ts:2476`). Verified independently by the moderator at `fleet.ts:1609`.

**So the board is not blind to the ceiling. It reads it and spends it on the concurrency bound.** What is genuinely missing is narrower than the plan states: the ceiling does not arrive through `spend-rate` into the *cadence* rule. The plan's central code reading — `refreshIntervalMs` takes one rate field and no ceiling — **is correct**, and that is why this is amend and not reject.

## Two regressions the plan cannot see, because it never names the rule

**The concurrency bound.** A ceiling arriving through `spend-rate` also reaches `boundFromLimit`. A declared `Rate ceiling: bitbucket 1000` proposes `floor(1000/900) = 1` — `MIN_CONCURRENCY` — **serialising every Bitbucket call on that board.** Nothing in `Done when` pins the concurrency bound as unchanged.

**The compounding warning the plan quotes around.** `cadence.ts:9-31` warns that *"reacting to an error here would compound with the division already happening and drift the cadence down with nothing to bring it back."* The plan quotes that file's constants and not its warning, then proposes a second consumer of the same reading on top of a cap that is already gating.

## The gate list can ship green and change nothing

`cadence` demonstrated a variant satisfying **every** stated gate — ceiling reaches the function ✓, real limit preferred ✓, no-ceiling case byte-identical ✓, no new host call ✓, both constants unchanged ✓ — that produces **the identical 240000 ms for every ceiling from 1000 down to 10**.

*"A declared ceiling reaches `refreshIntervalMs`"* tests plumbing, not effect. **No gate asserts that any interval differs from today's for any input.** That is the rejected sibling's failure mode exactly: a chain connected for its own sake.

Also unpinned: saturation (no gate requires the board to say it is at `MAX_CADENCE_STRETCH`) and convergence (an oscillating variant passes).

## The declaration sets a precedent the plan does not acknowledge

`declaration` enumerated every key on this estate (~30) and every key any script reads. **All are fixed, closed-vocabulary names.** Where a key carries several values the answer is always a *list in the value* — `Branch prefixes`, `Ticket prefixes`, documented as *"A LIST, because a repository mapping to several projects is the normal case"*.

**Not one key has a name that varies with runtime data.** The plan proposes the first, two levels deep, varying by connector *and* account — and never says what the key is called.

Worse, `plot-config.sh:141-165` matches a key as a **raw-interpolated prefix**. A lookup for a generic `Rate ceiling` would match a line reading `Rate ceiling bitbucket:`. And `get` exits 0 unconditionally, so a missing, misspelt or malformed declaration is indistinguishable from a deliberate default — **nobody would ever know the ceiling was wrong.**

## What the shared blind spot was

All three lenses read the code well. **None of them could check the plan's motivating fact** — the operator's report that `bb` polls too hard. `premise` states it plainly: *"No artefact on the estate records it. It is the plan's motivating fact and it rests on the Notes section alone."* This repository is on GitHub; no Bitbucket cadence is observable here.

So the panel validated everything except the reason the plan exists.

## What the caller should do

**The cheapest next step is a reading, not a branch.** On the repository whose `bb` board polls too hard:

```
skills/plot/scripts/plot-host.sh spend-rate
```

If it reports `limit: 1000, basis: predicted`, the question becomes whether `prConcurrencyBound` is already bounding it — and the remaining gap is a config key, a cadence input, or a concurrency cap that is not firing. **One command decides which plan to write.**

`premise` also names a likelier root cause than the plan's: `budget_rate` drops the limit whenever the newest line's basis is `unknown` (`plot-budget.sh:281-283`), so the ceiling never reaches the op the board asks. **That is a plumbing fix inside one script** and would deliver the plan's stated benefit for all three connectors without inventing a declaration.

An amended plan needs: the live `spend-rate` output replacing the quoted one; the subtitle corrected; `boundFromLimit` named as the existing reader with the gap restated as *the cadence does not read the ceiling the concurrency bound already reads*; a three-way precedence among `actual`, `predicted` and declared; a gate asserting an interval that **actually moves**; and a gate pinning the concurrency bound unchanged.

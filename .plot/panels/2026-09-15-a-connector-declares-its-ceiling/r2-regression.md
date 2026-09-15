# r2 — regression lens

Subject: `docs/plans/2026-09-15-a-connector-declares-its-ceiling.md` at `origin/main` bc4d00235 (amended).
Reading position: this plan feeds a NEW input into a rule that an existing, working consumer already reads. Everything below asks what a live board does when it lands.

## 1. The amended plan's headline measurement is false AGAIN, in the same field, on the same connector

The plan replaced round 1's quoted reading with one it labels **"Re-measured live"**:

```json
{"connector":"github","account":"jwloka","spent":1083,"perHour":1085.72,
 "limit":5000,"remaining":3229,"resetAt":1789468250000,"basis":"actual"}
```

Run now, three consecutive times:

```json
{"connector":"github","account":"jwloka","bucket":"","spent":148,"spanMs":3594299,"perHour":148.23,"lines":73089,"unreadable":0,"limit":null,"remaining":null,"resetAt":null,"basis":"unknown"}
{"connector":"github","account":"jwloka","bucket":"","spent":148,"spanMs":3594598,"perHour":148.22,"lines":73089,"unreadable":0,"limit":null,"remaining":null,"resetAt":null,"basis":"unknown"}
{"connector":"github","account":"jwloka","bucket":"","spent":148,"spanMs":3594980,"perHour":148.21,"lines":73089,"unreadable":0,"limit":null,"remaining":null,"resetAt":null,"basis":"unknown"}
```

**`limit: null`, `basis: unknown`.** The bolded sentence the amended Design rests on — *"**`limit: 5000`, `basis: actual`.**"* — is false right now.

This is not the moderator being unlucky twice. It is the **amendment's own Notes naming the mechanism and then not applying it**: `plot-budget.sh:281-283` keeps a limit only from the newest live line whose basis is not `unknown`, so the reading oscillates between `5000/actual` and `null/unknown` depending on whether a harvesting call happens to sit inside the rolling window. Round 1 measured `null`, the amendment measured `5000`, I measure `null`. **The field is not a fact about the connector — it is a fact about the last hour of call traffic**, and the plan quotes a sample of it as though it were stable.

**This matters to a regression lens specifically.** A ceiling that appears and disappears on a one-hour window is an input that **enters and leaves** `boundFromLimit` while the board runs. Section 4 is what that does.

## 2. `plot-host.sh:1984` is right for Bitbucket and wrong for Jenkins

`plot-host.sh:1984`, verified:

```
    bitbucket) printf '%s\t%s\t%s\t%s\n' 1000 - - predicted ;;
    *) printf '%s\t%s\t%s\t%s\n' - - - unknown ;;
```

Bitbucket's `1000 predicted` is there. **Jenkins is not** — it falls into the `*)` default and answers `unknown`. The plan's *"`plot-host.sh:1984` answers `bitbucket → 1000 predicted`, and Jenkins `60 predicted`"* attributes both to one line. Jenkins' 60 lives at **`plot-host.sh:3760`**, in the `limit` op, which is a **metered call** — a different function on a different path that the `spend-rate` reading never consults. The plan's *"all three connectors declare one"* is two-of-three through `budget_reading`.

Verified as stated: `limitReadingOf` at `fleet.ts:1619`, `boundFromLimit` at `concurrency.ts:139` (declaration line; the body is `:138-143`), `withHostSlot` at `fleet.ts:2476` and a second site at `:2146`, `refreshIntervalMs` at `cadence.ts:244` taking `Pick<SpendRate,'perHour'>` and no ceiling.

**Could not verify:** the operator's `bb`-polls-too-hard report. The plan concedes this.

## 3. The gap statement is true, and it is NOT the whole gap

*"The cadence does not read the ceiling the concurrency bound already reads."* — true as a code reading. `cadence.ts:244` takes one rate field; `fleet.ts:1643` reads `prLimit`/`prLimitBasis`.

**What it omits is that the concurrency bound does not reliably read it either.** On this estate the ceiling reaches `boundFromLimit` only when a harvesting call landed inside the window (section 1). So the true statement is *neither consumer reads a stable ceiling, and the cadence additionally has no parameter for one.* The plan's framing says the concurrency side is solved and only cadence is missing. It is not solved; it is intermittent. A plan that adds a second consumer to an intermittent input inherits the intermittency **and doubles its blast radius**.

## 4. What happens to a live board, per ceiling — the lens question

`boundFromLimit` (`concurrency.ts:138-143`), computed:

| ceiling | basis | `boundFromLimit` | live effect |
|---|---|---|---|
| 5000 | `actual` | **5** | 5 simultaneous host calls. Today's GitHub behaviour. |
| 1000 | `predicted` | **1** | `MIN_CONCURRENCY`. Every host call on that account serialised. |
| 60 | `predicted` | **1** | serialised. |
| none | `unknown` | **null** | unbounded — `withHostSlot:1872` returns `call()` with no slot. Today's actual GitHub behaviour on this estate. |

`SECONDS_PER_SLOT = 4`, so the divisor is 900. **Any ceiling below 1800 yields 1 or 2; any ceiling below 900 yields 1.** Round 1's warning is arithmetically confirmed: a declared 1000 is `floor(1000/900) = 1`.

**And serialisation is not the whole cost.** `withHostSlot` (`fleet.ts:1867-1899`) at a full account does not skip — it polls at `SLOT_POLL_MS = 1000` up to `SLOT_WAIT_MAX_MS = 30000`, then **proceeds unbounded anyway** (`:1887`). So a bound of 1 on a contended account converts each host call into up to 30 s of polling before making the call regardless. On the PR refresh path (`:2476`) that wait sits inside the refresh, and the CI-runs path (`:2146`) takes a slot per branch, up to `RUN_FETCH_MAX` branches — so the worst case is a slot wait **per branch, serially**, inside one refresh.

**The ratchet makes it permanent.** `applyReaction` (`fleet.ts:1594-1615`) seeds `entry.prConcurrency` from `boundFromLimit` on the first secondary refusal and `loweredConcurrency` **only ever falls** (`reaction.ts:232`, floored at `MIN_CONCURRENCY`). `concurrencyBound` (`concurrency.ts:169-175`) takes the `min` of proposal and correction. So a declared 1000 that produces a proposal of 1, met by one refusal, writes `prConcurrency = 1` — and **nothing in this codebase ever raises it**. Correcting the typo in `CLAUDE.md` does not recover the board; only a restart does.

**Now combine that with section 1.** The ceiling flickers. A board whose `prLimit` goes `null → 1000 → null` goes `unbounded → serialised → unbounded`, and if a refusal lands during the serialised window the ratchet pins it at 1 for the process lifetime. This is the concrete live-board answer: **an intermittent low ceiling is strictly worse than a stable one**, because it is the shape that seeds the ratchet without the operator ever seeing the board sit at 1 long enough to diagnose it.

## 5. Two guards exist today, and the plan's proposed path bypasses exactly the one that protects it

**Guard A — `fleet.ts:1789`:**

```ts
basis: basis === 'actual' || basis === 'predicted' ? basis : 'unknown',
```

with the comment *"AN UNRECOGNISED BASIS IS `unknown`, NEVER A GUESS. A record written by a newer Plot could name a fourth word, and reading it as `actual` would let an unrecognised value license a bound — the direction that spends."*

**Guard B — `LimitBasisSchema` (`limit.ts:26`):** a closed `z.enum(['actual','predicted','unknown'])`, carrying a `plot-state: classification` declaration.

The plan proposes *"A declared value is a **fourth** basis"* with precedence `actual` > declared > `predicted`. **That is a direct collision with both guards**, and the plan names neither. Two outcomes, both bad:

- **Route the declaration through `spend-rate`** and a `declared` basis is normalised to `unknown` at `:1789` — the ceiling is silently discarded and the plan ships a no-op. Safe, and useless.
- **Route it around `spend-rate`** — which is what *"read an optional per-connector rate ceiling from `## Plot Config`"* says — and the guard is bypassed by construction. A `LimitReading` assembled from config reaches `boundFromLimit`, whose only rejection is `basis === 'unknown' || limit === null`. **A `declared` basis passes. 1000 → 1.**

The second is the plan's own slice line. So the plan's proposed implementation path is precisely the one that defeats the guard written against it.

**Widening `LimitBasisSchema` to four words is not a local edit.** `limitFailureMode` (`limit.ts:35-43`) is an exhaustive `switch` with no default — adding a member is a typecheck failure across every consumer, which is the schema doing its job, and it is scope the plan does not mention.

## 6. Is the new gate sufficient?

The `Done when` says:

> **the concurrency bound `boundFromLimit` returns is unchanged for every one of those inputs**, pinned by a test

**Necessary, and not sufficient, on three counts.**

**(a) It pins the wrong function.** `boundFromLimit` is pure and takes a `LimitReading`. A test calling it with today's three readings passes **whatever the implementation does**, because the regression is not that `boundFromLimit` changes — it is that a *new caller constructs a new reading and hands it in*. The gate as written is green on the exact change it is meant to refuse. The function that must be pinned is **`prConcurrencyBound(entry)`** (`fleet.ts:1642`), the composed board-level answer, against an entry carrying a declared ceiling.

**(b) "for every one of those inputs" scopes to the no-ceiling cases.** Read against its antecedent, "those inputs" is the gh/bb/jen set from the preceding clause — connectors with **no** declared ceiling. The dangerous input is a connector **with** one. Nothing pins `prConcurrencyBound` for a declared ceiling of 1000.

**(c) Nothing pins the ratchet.** Even a correct static gate says nothing about `applyReaction` seeding `prConcurrency` from a declared proposal, after which the bound never recovers. That is the failure that outlives the config fix, and no stated gate reaches it.

**What would be sufficient**, and is cheap: a test asserting `prConcurrencyBound` is **identical with and without** a declared ceiling for the same entry, for 5000/1000/60/none — i.e. that the declared ceiling reaches the **cadence** and provably does **not** reach `limitReadingOf`. That is a structural separation, not a numeric coincidence, and it is the one gate that makes the two policies non-compounding by construction.

## 7. Can the two policies compound?

**Yes, and the plan's *"It does not change the stretch policy"* does not prevent it.** They are independent multipliers on the same account:

- cadence stretches the interval up to `MAX_CADENCE_STRETCH = 8` (240 s → 1920 s on Bitbucket, from `intervalMs * cost = 60000 * 4`)
- concurrency serialises calls within a refresh and adds up to 30 s of slot wait per call

A Bitbucket board at a declared 1000 gets **both**: refreshes 8x apart, each refresh internally serialised with slot waits. The plan asserts non-interference on the grounds that `MAX_CADENCE_STRETCH` and `CADENCE_DAMPING` are untouched — but compounding here is not a change to either constant, it is two rules reading one input. `cadence.ts:9-31` warns about exactly this shape: *"would compound with the division already happening and drift the cadence down with nothing to bring it back."* The amendment quotes that warning in *"It does not read the ceiling with a new host call"*, where it is answering a different question.

**Worse, the plan's own goal makes compounding directional.** The whole point is *a connector near its ceiling polls slower*. The concurrency bound already makes a connector with a low ceiling call less concurrently. **A low ceiling would then slow the board twice for one reason** — which is the definition of compounding, and it is the intended behaviour of the feature rather than an accident of it.

## 8. What `Done when` still fails to pin

Beyond §6:

- **Which direction the ceiling moves the cadence, and by what law.** "an interval ACTUALLY MOVES … asserting two different numbers" pins that two numbers differ. It does not pin *slower when nearer the ceiling*, nor monotonicity, nor that a 5000 ceiling and a 60 ceiling order correctly. A variant that moves the interval the **wrong way** satisfies it.
- **The config key's name and shape.** Round 1's `declaration` lens found `plot-config.sh` matches a key as a raw-interpolated prefix (`:141-165`, confirmed — `grep -m1 -iE "^[[:space:]]*[-*]?[[:space:]]*\**${key}[:*]"`), so a generic `Rate ceiling` lookup matches a line reading `Rate ceiling bitbucket:`, and `get` exits 0 unconditionally so a malformed declaration is indistinguishable from a default. **The amendment did not name the key**, and the gate list does not require it to parse or to be validated.
- **The lower bound on a declared value.** Nothing refuses a declared `10`, or `0`, or a negative. `boundFromLimit` rejects `<= 0` but a declared 10 is accepted and yields 1.
- **The ratchet** (§6c).
- **`spendRateFor`'s normalisation** (§5 Guard A) — whether the declaration goes through it or around it is unstated, and it is the whole safety question.

## 9. The strongest argument against doing this at all

**The plan's own Notes contain a cheaper, strictly-dominating alternative, and section 1 is now evidence for it.**

> `plot-budget.sh:281-283` drops the limit whenever the newest line's basis is `unknown`, so the ceiling may never reach the op the board asks. If that is the whole defect it is a plumbing fix inside one script and this plan is unnecessary.

I measured that defect firing, on this repository, three times in a row. The ceiling **is** declared for Bitbucket (`plot-host.sh:1984`) and **is** read for GitHub headers, and it still arrives `null`. So:

- the fix delivers the plan's stated benefit **for all three connectors**
- it needs **no config key**, hence no new key-naming precedent and no `plot-config.sh` prefix-matching hazard
- it needs **no fourth basis**, hence no `LimitBasisSchema` widening and no bypass of `fleet.ts:1789`
- it touches **one script**, not a domain schema plus two rules plus a controller

And the plan **cannot be shown to be needed until that fix lands**, because with the plumbing broken nobody knows whether a stable ceiling would have been enough. The plan is proposing a new input path to carry a value that an existing path already carries and drops.

Against that, the plan's one genuine contribution — `refreshIntervalMs` has no ceiling parameter — is real and survives. But it is a one-parameter change to one rule, and it does not need a declaration mechanism to exist.

## Position

The plan is now correct about the code and wrong about the estate: its central reading (`cadence.ts:244` takes one field) holds, and its headline measurement is false for the second consecutive round in the same field. That alone is amend, not reject — but the regression case is the deciding one.

The proposed path **bypasses the exact guard written against it** (`fleet.ts:1789`, whose comment predicts "a fourth word"), lands on `boundFromLimit`'s `floor(limit/900)`, and is caught by a ratchet that never recovers. The new gate pins a pure function that cannot fail, not the composed bound that can. The two policies compound, and compound *by design* rather than by accident.

The amendment is not safe as written. What it needs is small and specific:

1. Drop the fourth basis. Carry the declared ceiling to the **cadence** in its own parameter and never into a `LimitReading`; pin that structurally.
2. Re-gate on **`prConcurrencyBound(entry)`** identical with and without a declaration, for 5000 / 1000 / 60 / none.
3. Pin the ratchet: a declared ceiling must never seed `entry.prConcurrency` via `applyReaction`.
4. Replace the quoted `spend-rate` sample with the **finding** that the reading oscillates, and name `plot-budget.sh:281-283` as a prerequisite rather than an alternative.
5. Name the config key and pin that `plot-config.sh` parses it unambiguously.
6. Correct `plot-host.sh:1984` → Jenkins' 60 is at `:3760`, on the metered `limit` op, not in `budget_reading`.

Verdict: amend

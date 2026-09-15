# Decision — scope, EVIDENCE lens

**Question:** should `a-connector-declares-its-ceiling` ship the cadence wiring only, the wiring plus the declared config key, or neither?

**Reading position:** only build what a measurement demands. For each option I asked: *what artefact on this estate today would be different if it shipped?* A benefit nobody can observe is not counted. Every number below names whether it is one sample or a distribution.

## 1. Verifying the briefing — two claims are false, and one of them is load-bearing

I re-ran the readings rather than trusting the summary. The ledger is `/Users/jwloka/.plot/state/budget.tsv` (`plot-budget.sh:59-66`), 132,136 lines. Field 2 is the connector, 6 the spend, 7 the limit, 10 the basis.

**TRUE — the central code reading.** `refreshIntervalMs` (`cadence.ts:244`) takes `rate: Pick<SpendRate, 'perHour'> | null`. One field, no ceiling. Verified at source.

**TRUE — the ceiling already has a non-cadence consumer.** `limitReadingOf` (`fleet.ts:1619`) → `boundFromLimit` (`concurrency.ts:138`) → `prConcurrencyBound` (`fleet.ts:1643`). The ceiling becomes a concurrency cap and reaches the cadence nowhere. `grep` over `packages/board/src packages/domain/src` returns zero references joining `prLimit` to `prRefreshMsFor`.

**TRUE — the fourth-basis problem.** `fleet.ts:1789` normalises any unrecognised basis to `unknown`; `LimitBasisSchema` (`limit.ts:26`) is a closed 3-enum. A `declared` basis would be silently erased at the parse boundary.

**TRUE — `boundFromLimit({1000,'predicted'})` = 1.** `Math.max(MIN_CONCURRENCY, Math.floor(1000/900))` = `max(1,1)` = 1. Bitbucket host calls are already serialised.

**FALSE — "GitHub reports `basis: actual` on 42 of 73,097 lines (0.06%) and the field self-evicts hourly."** The count is right; the framing is wrong in the direction that matters. Live, right now:

```
{"connector":"github","account":"jwloka","spent":263,"perHour":265.87,
 "lines":73286,"limit":null,"remaining":null,"resetAt":null,"basis":"unknown"}
```

The plan's Design (lines 45-52) prints a `limit:5000, basis:actual` reading as the measurement that overturned the previous draft. **I cannot reproduce it.** GitHub's live basis is `unknown` with `limit: null`. All-time: 73,250 `unknown` against 42 `actual` — the 42 are the anomaly, not the state. **The plan's headline measurement has now been overturned a third time**, and this time in the direction that removes GitHub from the argument entirely.

**FALSE — "Jenkins `60 predicted`."** `plot-host.sh:1979-1982` has exactly two arms: `bitbucket) … 1000 predicted` and `*) … unknown`. Jenkins falls to the wildcard. The ledger agrees: 8,322 Jenkins lines, **every one `unknown`, limit `-`**. The plan's claim that "all three connectors report one" (line 53) is false — **one** does.

**FALSE, and this is the important one — the "likelier root cause" the plan names and declines to adopt.** Plan lines 157-161 say `plot-budget.sh:281-283` "drops the limit whenever the newest line's basis is `unknown`". The code does the **opposite**. At `:283`:

```awk
if (c_basis[i] != "unknown" && (newest < 0 || c_at[i] >= newest)) {
```

It deliberately **skips** `unknown` lines to find the newest line that *does* carry a reading — and the comment above it names the exact defect ("one of those arriving after a measurement would erase it", measured 2026-09-02) as **already fixed**. The plan's own escape hatch — *"if that is the whole defect this plan is unnecessary"* — rests on a misreading of the fix that closed it. That escape route is gone, which strengthens the case for a real wiring change rather than weakening it.

## 2. `wiring-only` — a connector whose ceiling is present and unused by the cadence

**Yes. Bitbucket, and it is a distribution rather than a sample.**

Present: 48,550 ledger lines carry `limit=1000, basis=predicted`. Every Bitbucket line on the estate, all time — 100%, no exceptions.

Unused by the cadence: the ceiling reaches `boundFromLimit` and stops. `prRefreshMsFor` (`fleet.ts:1724`) declares `rate: { perHour: number | null } | null`, and passes it to a rule typed `Pick<SpendRate,'perHour'>`. The value is present in the object and discarded by the type.

**The saturation, hour by hour, `bitbucket/quatico` against its declared 1000:**

| window | spent | saturation |
|---|---|---|
| h-0 | 720 | 72% |
| h-1 | 780 | 78% |
| h-2 | 683 | 68% |
| h-3 | 608 | 61% |
| h-4 | 850 | 85% |
| h-5 | 822 | 82% |
| h-6 | 772 | 77% |
| h-7 | 743 | 74% |
| h-8 | 759 | 76% |
| h-9 | 896 | 90% |
| h-10 | 863 | 86% |
| h-11 | 870 | 87% |

**Twelve consecutive hours, 61–90%, never below 61%, median ~78%.** This is the one claim in the entire decision resting on a distribution rather than a single reading, and it is the claim that matters. The briefing's "771/hr = 77%" is one point inside this band — correct, and understated as evidence.

**The artefact that would differ if `wiring-only` shipped:** `entry.prIntervalMs` for the Bitbucket entries. Today it is computed from `perHour` alone, so a connector at 87% of a ceiling it declares and a connector at 8% of one produce the same interval whenever their observed rates match. That is an observable number in a live board's cache, and it would change. **The benefit is observable — it passes my bar.**

A second account corroborates independently: `bitbucket/plot-pm` at 424 calls/hr = 42%. Same connector, same declared ceiling, **half the saturation**. That pair is exactly the "two different numbers" the plan's Done-when demands, and it exists in today's ledger without fabricating a fixture.

**GitHub and Jenkins would be byte-identical** — `limit: null` yields no ceiling, so the null path must return today's number. That is the plan's own pin, and it is the right one.

## 3. `both` — a connector that NEEDS the declaration

**None exists on this estate. I searched and I am saying so plainly.**

The test is the plan's own: a ceiling *absent and unknowable without a human declaring it*. Two connectors have an absent ceiling:

- **Jenkins** — 8,322 lines, all `unknown`, limit `-`. Ceiling absent. But this estate's Jenkins is `account=unknown`, and no artefact here records a Jenkins rate refusal, a Jenkins saturation, or an operator complaint. **Nothing observable would change if a Jenkins ceiling were declared**, because nothing on this estate reads a Jenkins cadence under pressure.
- **Jira** — 1,984 lines, all `unknown`. Worse: 1,941 of them are `me@acme.test` and 3 are `a@b.c`. **Those are test fixtures, not traffic.** Only 40 lines belong to a real account. A config key serving this population is serving a test harness.

The connector that is actually under pressure — Bitbucket, the only one with a measured problem — **already declares its ceiling in the shell** (`plot-host.sh:1980`), and 100% of its ledger lines carry it. A config key would let an operator restate a number the adapter already supplies correctly. That is the definition of a benefit nobody can observe.

**The steelman, and why it fails on evidence.** The plan's strongest argument for `both` is line 114: *"whether `limit: 60` matches a given instance is a question only its operator can answer."* It is a real argument — and it names a Jenkins default of 60 **that does not exist in the code**. `plot-host.sh` gives Jenkins no number at all. So the plan's one concrete case for the declaration cites a value I could not find in the file it cites.

`both` also carries a cost the plan itself identifies and does not resolve: a fourth `declared` basis must survive `fleet.ts:1789`, which normalises unrecognised bases to `unknown`, and `LimitBasisSchema`'s closed enum. Widening a classification enum that `boundFromLimit` reads means the declaration reaches the **concurrency** bound too — and `boundFromLimit(declared 1000)` = 1 = `MIN_CONCURRENCY`. The plan calls this "a regression this plan must pin against, not a benefit" (line 105). It is being asked to ship a vocabulary change whose first effect is a regression it must then pin shut. **Paying enum-widening cost for a population of zero is the trade I refuse.**

## 4. What each option costs if the premise is overturned a fourth time

The premise has now been overturned three times — twice per the briefing, and a third time by me in §1, where the current Design's own headline reading does not reproduce and its named alternative root cause is a misreading of a shipped fix. **The base rate of this plan's measurements surviving contact is poor, and that must price the options.**

- **`wiring-only` — cheapest to be wrong.** It adds one parameter to one rule and widens one call-site type. If the ceiling turns out to be the wrong cadence input, the damage is bounded by the null path: GitHub, Jenkins and Jira are pinned byte-identical, so a bad ceiling can only misprice Bitbucket, and only within `MAX_CADENCE_STRETCH = 8`. Reverting is one parameter. **No vocabulary is created, so nothing outlives the revert.**
- **`both` — most expensive to be wrong, and the cost is permanent.** A config key and a fourth basis are **public vocabulary**. Operators write the key into `## Plot Config`; the enum widens in a schema three rules read. If the premise fails again, the wiring reverts cleanly and the vocabulary does not — a declared key that no longer feeds anything becomes config that lies, and the estate already has a documented allergy to two records of one fact. This is the option whose blast radius survives its own refutation.
- **`neither` — costs the one thing that is genuinely measured.** It would discard a distribution: twelve hours at 61–90% on a connector whose ceiling is present, universal across 48,550 lines, and read by nothing in the cadence. `neither` is the right call when the evidence supports no half; here the evidence supports one half strongly and the other not at all. Rejecting both treats a verified finding and an unverified one identically, which is the failure mode of over-correcting after being wrong twice.

## 5. Commitment

The evidence splits the plan cleanly rather than validating or rejecting it.

**The wiring half is demanded by a measurement.** One connector, ceiling present on 100% of its 48,550 lines, running 61–90% of it across twelve consecutive hours, with a second account at 42% for contrast — and that ceiling reaching the concurrency bound while the cadence is typed not to see it. A specific artefact (`entry.prIntervalMs` for Bitbucket) would take a different value. That is a demand, and it is a distribution.

**The declaration half is demanded by nothing.** No connector on this estate has a ceiling both absent and consequential. The two with absent ceilings are an unused Jenkins and a Jira whose traffic is 98% test fixtures. The connector with the real problem already declares its ceiling in the adapter. The plan's one concrete argument for the key cites a Jenkins default of 60 that is not in the file.

Build the half a measurement demands; leave the half that would create permanent vocabulary for a population of zero. If a real connector later needs a declared ceiling, the wiring will already be there to receive it — and the declaration can be added then, against an artefact instead of against an argument.

Choice: wiring-only

# Decision — scope, OUTCOME lens

Subject: `docs/plans/2026-09-15-a-connector-declares-its-ceiling.md` (Draft)
Lens: what the live board DOES the day after each option ships.
Every number below was re-derived on this machine on 2026-09-15.

## 1. The facts, re-run

**The prompt's `spend-rate` invocation form is wrong, and the wrong form hides the subject.** `plot-host.sh spend-rate github` dies with `unknown arg github` (`plot-host.sh:3819`); the op takes `--connector`. And `--connector bitbucket` alone defaults the account to `budget_account "$be"` = `jwloka`, which on this machine answers `lines: 0`. **The Bitbucket account that carries the traffic is `quatico`.**

Live, this machine:

```
gh  --connector github    --account jwloka   perHour 268.35  limit null  basis unknown  lines 73294
bb  --connector bitbucket --account quatico  perHour 721.14  limit 1000  basis predicted lines 40496
bb  --connector bitbucket --account plot-pm  perHour 2030.27 limit 1000  basis predicted lines  7747
jen --connector jenkins   --account unknown  perHour null    limit null  basis unknown  lines  8324
```

Ledger `~/.plot/state/budget.tsv`, 132,156 lines, basis distribution:

```
73251 github unknown      48555 bitbucket predicted
 8324 jenkins unknown      1984 jira unknown
   42 github actual
```

**Confirmed:** `bitbucket → 1000 predicted` at `plot-host.sh:1984`; 100% of Bitbucket's lines carry it. `github actual` is 42/73,293 = **0.057%**, self-evicting. `boundFromLimit({1000,'predicted'})` = `max(1, floor(1000/900))` = **1** = `MIN_CONCURRENCY` (`concurrency.ts:141-142`) — Bitbucket is already serialised. `refreshIntervalMs` (`cadence.ts:244`) takes `Pick<SpendRate,'perHour'>` and no ceiling.

**Two corrections.** The prompt says `771/hr, 770/770 in-window, 77%`; live it is **721.14/hr, 40,496 in-window, 72%**. Same conclusion, drifting number — the round-2 rule that a single reading of this field is not evidence applies to the rate too. And **there is a second Bitbucket account nobody has named: `plot-pm` at 2030/hr, 203% of the declared 1000.** Already over the ceiling. No option on the table addresses it, because none of them refuses a call.

## 2. What the board does today — the reading nobody took

The lens was told to measure `targetStretch`'s current output before concluding. Here it is. `PR_REFRESH_MS` = 60,000 (`fleet.ts:116`); `PR_REQUESTS_PER_REFRESH` github 1, bitbucket 4 (`fleet.ts:184`). `targetStretch` takes its share at the **unstretched** cadence (`cadence.ts:131`), so the share is **60/hr on both hosts** — Bitbucket's base interval is 240,000 ms, not 60,000.

`targetStretch` returns `MAX_CADENCE_STRETCH` the moment `others >= share` (`cadence.ts:139`). `others = perHour - share(current)`. At base that means **perHour >= 120/hr pins the board at 8x.**

Iterated to a fixed point (400 steps, damping 0.25):

| account | perHour | base | target@base | **fixed point** | stretch | board spend | % of ceiling |
|---|---|---|---|---|---|---|---|
| bb/quatico | 721.14 | 240 s | **8.000** | **1,920,000 ms = 32.0 min** | **8.000x** | 7.5/hr | **0.75%** of 1000 |
| bb/plot-pm | 2030.27 | 240 s | **8.000** | **1,920,000 ms = 32.0 min** | **8.000x** | 7.5/hr | 0.75% of 1000 |
| gh/jwloka | 268.35 | 60 s | **8.000** | **480,000 ms = 8.0 min** | **8.000x** | 7.5/hr | 0.15% of 5000 |

**Every live connector on this machine is already pinned at `MAX_CADENCE_STRETCH`.** The Bitbucket board refreshes once every 32 minutes and spends 7.5 requests an hour against a 1000/hr ceiling. The threshold to reach the clamp is 120/hr; Bitbucket observes 721 and GitHub 268 — **6x and 2.2x past it.**

I also ran the counterfactual: a Bitbucket account at 100/hr still converges to 8x, and only at **40/hr** does the stretch fall to 1.000x. The rule leaves the clamp somewhere between 40 and 120/hr of *total account* traffic. This estate's Bitbucket accounts are an order of magnitude above that.

## 3. The rubric

**(2) For `wiring-only` — is there a connector whose ceiling is present and unused by the cadence?**

**Yes, and it changes nothing.** Bitbucket: ceiling 1000, `predicted`, on 100% of 40,496 in-window lines, read by `limitReadingOf` (`fleet.ts:1619`) and consumed by `boundFromLimit` — never by `refreshIntervalMs`. The plan's code reading is correct.

But the *outcome* question is not whether the value is unused; it is whether using it moves a number. **It cannot, in the direction the feature is for.** The cadence is saturated at 8x. A ceiling input can only ever say *slow down further*, and `cadence.ts:195` clamps at `MAX_CADENCE_STRETCH` regardless. Ship `wiring-only` and the Bitbucket board refreshes every 32 minutes the day before and every 32 minutes the day after. **Zero observable change**, on the one connector that is the plan's named beneficiary.

The only inputs where a ceiling term could move the interval are accounts **below 120/hr** — quiet ones, where the board polls at 1x and the ceiling is by definition far away. That is the region where slowing down is least justified. **The feature is off in exactly the region it was built for and live only where it is unwanted.**

**(3) For `both` — name a connector that NEEDS the declaration.**

**None exists.** Round 2 established this and I confirm it independently: Bitbucket already answers `1000 predicted` from `plot-host.sh:1984`, so the plan's only named beneficiary does not need the config key that is its headline feature. Jenkins has **no arm** in `budget_reading` (`:1983-1986` is `bitbucket)` then `*) unknown`) — but 8,324 Jenkins lines all read `perHour: null`, so its cadence is on the `if (perHour === null) return current` path (`cadence.ts:189`) and a ceiling is not consulted at all. GitHub reports `actual` 0.057% of the time and is at 8x regardless.

So `both` adds a config key, a fourth basis word, and precedence logic — for zero connectors. And it adds them where the estate's own guard predicted the failure: `fleet.ts:1789` normalises an unrecognised basis to `unknown`, `LimitBasisSchema` (`limit.ts:26`) is a closed three-enum. Via `spend-rate` the declaration is silently discarded; via `## Plot Config` it bypasses the guard and reaches `boundFromLimit`, where **any ceiling below 900 returns 1.**

**(4) What each option costs if the measured premise is wrong again.**

The premise has now been wrong **twice in two rounds, in opposite directions**, on a field that self-evicts hourly. Price each option against a third reversal.

- **`wiring-only`** — a new parameter on a pure function plus its tests. If the premise flips, the parameter is inert (the clamp absorbs it) and removing it is a one-signature revert. **Bounded, recoverable, and currently worth nothing.**
- **`both`** — a config key is a **published interface**. Once an adopting repo writes `Bitbucket ceiling: 1000` into its `CLAUDE.md`, removing the key is a breaking change to every such repo, and the declaration is keyed by connector *and account* so it multiplies. Worse, the value flows to `boundFromLimit`, and `applyReaction` (`fleet.ts:1594`) seeds `prConcurrency` from it while `loweredConcurrency` **only ever falls** — one refusal during a flicker pins the board at concurrency 1 **for the process lifetime**, recoverable only by restart. A wrong declared number is therefore not merely inert: it is a one-way ratchet into serialised host calls plus up to 30 s of `withHostSlot` polling per call (`fleet.ts:1867-1890`). **Unbounded and not self-correcting.**
- **`neither`** — costs one round of re-measurement. Nothing ships, nothing is published, the ratchet is untouched.

**Is the operator's complaint fixed?** *"bb polls too hard."* The board's own contribution is **7.5 requests an hour — 0.75% of the 1000 ceiling.** The account burns 721/hr and, on `plot-pm`, 2030/hr. **The board is not the spender.** Neither option touches the other 99.25%, because neither refuses a call — the plan says so explicitly (*"It does not refuse a call"*). Both options are answers to a question the measurement has already closed: the cadence rule has done everything it is capable of doing, and the traffic is elsewhere — eleven scripts, dispatched workers, and a person at a terminal, which is precisely the population `cadence.ts:150-153` says the record exists to capture.

## 5. Commitment

Ship neither. The cadence is **already at its ceiling on every live connector**, so `wiring-only` is provably unobservable on the connector it targets; `both` is unobservable *and* publishes an interface with a one-way ratchet behind it, for zero connectors that need it.

The plan's code reading survives — `refreshIntervalMs` genuinely takes no ceiling — but a true reading of the code is not a reason to ship when the arithmetic says the output cannot move. The finding worth keeping is the one this lens produced: **the board is pinned at 8x and contributes 0.75% of Bitbucket's spend, and a second account, `plot-pm`, is at 203% of its declared ceiling with nothing watching it.** That is where the operator's complaint actually lives, and it is a different plan — one about refusing or attributing calls, not about stretching a cadence that has stopped stretching.

If the estate wants a change that moves an observable number, the candidates in order are: raise or revisit `MAX_CADENCE_STRETCH` (the board is clamped, not tuned), attribute the 721/hr to its real spenders, and look at `plot-pm` at 2030/hr. None of those is this plan.

Choice: neither

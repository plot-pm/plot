# r2 — alternative lens

Subject: `docs/plans/2026-09-15-a-connector-declares-its-ceiling.md` (amended text)
Lens: the cheaper candidate fix the plan names and declines, versus doing nothing.

## 1. The amended plan's headline measurement is FALSE AGAIN — and this time it is the panel's number, not the plan's

The plan's Design quotes, as the live re-measurement that overturned round 1:

```json
{"connector":"github","account":"jwloka","spent":1083,"perHour":1085.72,
 "limit":5000,"remaining":3229,"resetAt":1789468250000,"basis":"actual"}
```

Run now (2026-09-15, this estate):

```json
{"connector":"github","account":"jwloka","bucket":"","spent":148,"spanMs":3593712,
 "perHour":148.26,"lines":73089,"unreadable":0,"limit":null,"remaining":null,
 "resetAt":null,"basis":"unknown"}
```

**`limit: null`, `basis: unknown`.** That is the ORIGINAL plan's reading, the one
the panel declared false and the amendment deleted as a "false section".

Both readings were true when taken. Neither is a property of the code — **the
GitHub ceiling oscillates in and out of view on a ~1h period**, and which one a
reader sees depends only on when they ran the command. The plan now asserts as
settled fact a reading with a half-life of under an hour, and calls the opposite
reading an error. That is the same defect the panel corrected, committed in the
other direction.

### The mechanism, measured

`$HOME/.plot/state/budget.tsv` — 130,625 lines. Basis distribution:

| basis | lines |
|---|---|
| `unknown` | 82,853 |
| `predicted` | 47,730 |
| **`actual`** | **42** |

All 42 `actual` lines are GitHub. The newest sits at `1789467240021` carrying
`resetAt=1789468250000`.

`budget_rate`'s window (`plot-budget.sh:264-265, 268-269`) opens at the latest
reset that has **already passed**:

```
window start = 1789468250000  (passed_reset; now-1h = 1789469786000)
```

The `actual` line predates its own announced reset by **1,009,979 ms**. So the
window that line announced is the window that **excludes it**. Measured in the
live window for github/jwloka:

```
lines in window: 149 ; of which basis=actual: 0
```

**Zero.** A GitHub `actual` reading is visible only between the moment it is
harvested and the moment the reset it announces passes — then it is evicted by
the very field it carries, and nothing replaces it until the next harvest. 42
harvests across 130,625 calls is a 0.03% rate.

## 2. Is the line-281 candidate fix the whole defect? NO — and this is my lens's central finding

The plan's Notes name it and decline it:

> `plot-budget.sh:281-283` drops the limit whenever the newest line's basis is
> `unknown`, so the ceiling may never reach the op the board asks. If that is
> the whole defect it is a plumbing fix inside one script and this plan is
> unnecessary.

I read the code and simulated the fix. **It is not the whole defect, and on
GitHub it fixes nothing at all.**

`plot-budget.sh:283` selects the newest line whose basis is not `unknown`:

```awk
if (c_basis[i] != "unknown" && (newest < 0 || c_at[i] >= newest)) {
```

and `:303` blanks a limit carried under `unknown`. Removing or relaxing that
filter lets the newest line win outright. I simulated exactly that against the
live ledger:

```
lines in window: 149 ; of which basis=actual: 0
```

**There is nothing in the window for the relaxed filter to stop dropping.** The
line-281 filter is not what removed the GitHub ceiling — the *window filter* at
`:264-265` removed it, one layer earlier, and it did so correctly: a reading
describing a bucket that has since refilled genuinely is stale. The candidate
fix addresses a filter that, on this connector, never sees an `actual` line to
reject.

So the plan is right to decline it, but **its stated reason is wrong**. The
Notes say it *"may"* be the whole defect and leaves it open. It is not, and one
awk simulation settles it. That open question should be closed in the plan text.

### And on the connector the plan is actually about, the candidate fix is irrelevant for the opposite reason

```json
{"connector":"bitbucket","account":"quatico","spent":770,"perHour":776.30,
 "limit":1000,"remaining":null,"resetAt":null,"basis":"predicted"}
```

**Bitbucket already reports its ceiling cleanly — `limit: 1000, basis:
predicted` — through `budget_reading` (`plot-host.sh:1984`), on every one of the
770 calls in the live window.** 770 `predicted` lines in window, newest limit
`1000`. Nothing drops it. There is no plumbing defect on the bitbucket path.

**This is the plan's case, and it is stronger than the plan states it.** Bitbucket
is running at **776/hr against its own declared 1000/hr — 78% of ceiling** — and
`refreshIntervalMs` (`cadence.ts:244-258`) takes `Pick<SpendRate, 'perHour'>`
and cannot see the 1000. The board is stretching bitbucket's cadence on
`perHour` alone while a usable ceiling sits in the same reading it already
fetched.

**So the answer to the lens question: the ceiling DOES reach the op the board
asks — for bitbucket, today, at 78% saturation. The gap is real and it is the
cadence's.**

## 3. The third option — doing nothing

The moderator's strongest point stands: the motivating report (`bb` polls too
hard) is recorded nowhere, and this repo is on GitHub. I weighed doing nothing
seriously and **reject it**, on one measurement the panel did not have:

`perHour 776.30` against `limit 1000` is not an unobservable report. It is a
number this estate produces on demand, on the bitbucket connector, right now.
The operator's report is uncorroborated as a *complaint*; it is corroborated as
a *condition*. 78% of a declared ceiling, with the cadence rule structurally
unable to read the ceiling, is a defect whether or not anyone filed it.

Doing nothing also leaves the GitHub path in the state measured in §1 — a
ceiling that exists for minutes per hour and is invisible the rest of the time,
with **no artefact recording that oscillation**. That is a fact worth capturing
regardless of which plan ships.

## 4. Which of the three is the right next move

Not the candidate fix (§2: fixes nothing measurable). Not nothing (§3). **The
plan — with its premise restated on the connector that actually demonstrates
it.**

But the plan as written argues from GitHub, where the evidence is a 42-line,
0.03%-of-calls, sub-hour-lived reading that was `null` when I ran it. Its own
case lives on bitbucket, where the reading is stable, present on 770 of 770
in-window calls, and sitting at 78% of ceiling. The plan should lead with that
and stop quoting a GitHub reading as a fixed fact.

## 5. What the `Done when` still fails to pin

The round-1 gaps are largely closed — an interval that ACTUALLY MOVES, the
concurrency bound pinned unchanged, convergence, saturation. Four remain:

1. **No gate pins the reading's volatility.** Nothing requires the rule to behave
   sanely when a ceiling is present on one refresh and absent on the next —
   which §1 proves is GitHub's *normal* behaviour, roughly hourly. A ceiling that
   appears, tightens the interval, then vanishes and releases it, oscillates by
   construction. The convergence gate iterates to a fixed point **with a fixed
   input**; it cannot see this.
2. **The config key is still unnamed.** Round 1 raised it; the amendment did not
   answer it. The plan says "an optional per-connector rate ceiling from `## Plot
   Config`" and never gives the key's spelling, nor how it carries two levels
   (connector and account) against an estate where every key is a fixed name with
   a list in the *value*.
3. **Nothing pins a wrong declaration being detectable.** `plot-config.sh get`
   exits 0 unconditionally, so a misspelt key is indistinguishable from a
   deliberate default. "Prefer a vendor-reported limit" is pinned; "notice the
   operator typed the key wrong" is not.
4. **Jenkins is pinned against a ceiling it does not have.** The plan states
   "Jenkins `60 predicted`" and `plot-host.sh:3760` does return that — but that
   is the `limit` op. `budget_reading` (`:1983-1986`) has **no jenkins arm**:
   `bitbucket)` then `*) unknown`. Live: `{"connector":"jenkins",...,"limit":null,
   "basis":"unknown"}`. So the "byte-identical across gh, bb and jen" gate will
   pass for jenkins for the wrong reason — it has no ceiling to pass through —
   and the plan's Design table implies it does.

## 6. Answers to the rubric

**1. Every factual claim true on main?** No. `plot-host.sh:1984` ✓ (bitbucket
1000 predicted). `fleet.ts:1619` ✓ (`limitReadingOf` at 1618-1628, off by one,
immaterial). `concurrency.ts:139` ✓ (`boundFromLimit`, and `floor(1000/900)=1`
→ `MIN_CONCURRENCY` confirmed at :142-143). `cadence.ts:244` ✓ (`refreshIntervalMs`
takes `Pick<SpendRate,'perHour'>`, no ceiling). **FALSE:** the quoted live
`spend-rate` JSON (§1 — now `limit: null, basis: unknown`). **MISLEADING:**
"Jenkins `60 predicted`" as a spend-rate basis (§5.4). **Could not verify:** the
operator's `bb`-polls-too-hard report, unchanged from round 1.

**2. Is "the cadence does not read the ceiling the concurrency bound already
reads" true, and the whole gap?** True, and verified in code. **Not the whole
gap.** It omits that the ceiling's *availability* differs per connector by two
orders of magnitude — stable on bitbucket (770/770 in window), near-absent on
GitHub (0 in window, 42 lines total). A rule reading "the ceiling" as though it
were uniformly present is reading one thing on bitbucket and nothing on GitHub
most of the time.

**3. `Done when` gaps:** §5 — volatility, the key's name, undetectable
misdeclaration, and jenkins pinned against an absent ceiling.

**4. Strongest argument against doing this at all:** the plan has now had its
headline measurement overturned **twice**, in opposite directions, by the same
one-line command — because that command's answer is not stable. A plan whose
motivating fact changes hourly, on a connector that is not the connector the
plan is about, argues from evidence too volatile to design against. The honest
answer is to re-premise on bitbucket, where the number holds still.

That argument is strong enough to demand an amendment and not strong enough to
kill the plan: bitbucket at 776/1000 with a cadence rule that cannot read the
1000 is a real defect, measured, on this estate, today.

## Required amendments

1. Replace the quoted GitHub `spend-rate` JSON with the bitbucket one, and state
   the GitHub ceiling's oscillation (42 `actual` lines in 130,625; 0 in the live
   window; evicted by its own `resetAt`) as a **finding**, not a premise.
2. Close the open question in Notes: the `plot-budget.sh:281-283` fix recovers
   nothing on GitHub (0 `actual` lines in window to un-drop) and is unnecessary
   on bitbucket (ceiling already arrives). Record the simulation.
3. Correct the jenkins claim: `budget_reading` has no jenkins arm, so jenkins
   reports `basis: unknown` and has no ceiling to plumb.
4. Name the config key and its two-level shape; pin a misdeclaration as
   detectable given `plot-config.sh get` exits 0 unconditionally.
5. Add a gate for a ceiling that appears and disappears between refreshes.

Verdict: amend

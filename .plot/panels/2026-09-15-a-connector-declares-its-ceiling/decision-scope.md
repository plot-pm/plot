# Decision panel — what should the ceiling plan ship?

Subject: `docs/plans/2026-09-15-a-connector-declares-its-ceiling.md`
Lenses: evidence, adoption, outcome. Vocabulary: `wiring-only | both | neither`.
Reconciliation: **divided — wiring-only=adoption,evidence · neither=outcome**

## Unanimous on the part that was actually asked

**No juror chose `both`.** All three independently confirm that **no connector on
this estate needs the declaration**: Bitbucket already answers `1000 predicted`
(`plot-host.sh:1984`) on 100% of its lines, Jenkins has no arm in `budget_reading`
but reads `perHour: null` across 8,324 lines so its cadence never consults a
ceiling at all, and GitHub reports `actual` on **0.057%** of readings.

**The config key at the plan's centre has no beneficiary.** That part is settled.

## The dissent is arithmetic, and the moderator verified it

`outcome` was asked to compute what the board actually does the day after each
option ships. Its answer, confirmed independently:

**The cadence is already clamped.** `cadence.ts:139` returns
`MAX_CADENCE_STRETCH` the moment `others >= share`, and `MAX_CADENCE_STRETCH = 8`
(`:32`). `targetStretch` takes its share at the **unstretched** cadence
(`cadence.ts:131`), so the share is 60/hr on both hosts and **any account above
~120/hr is pinned at 8×.**

Measured: Bitbucket observes **721/hr** and GitHub **268/hr** — 6× and 2.2× past
the clamp.

> **Every live connector on this machine is already at `MAX_CADENCE_STRETCH`.**
> The Bitbucket board refreshes once every 32 minutes.

**So a ceiling input cannot move the number.** It can only ever say *slow down
further*, and the clamp already refuses that. **Ship `wiring-only` and the board
refreshes every 32 minutes the day before and every 32 minutes the day after —
zero observable change on the plan's named beneficiary.**

## And the board is not the spender

`outcome`'s decisive finding, and it reframes the operator's complaint:

**The board contributes 7.5 requests an hour — 0.75% of Bitbucket's spend.** The
account burns 721/hr. Neither option touches the other **99.25%**, because
neither refuses a call — the plan says so itself: *"It does not refuse a call."*

**"bb polls too hard" is not about the board's cadence.** It is about eleven
scripts, dispatched workers, and a person at a terminal — precisely the
population `cadence.ts:150-153` says the record exists to capture.

## A second account nobody had named

**Verified by the moderator**, from the ledger:

```
bitbucket / quatico : 40,516 lines
bitbucket / plot-pm :  7,779 lines   ← 2030/hr = 203% of the declared 1000
bitbucket / unknown :    314 lines
```

**`plot-pm` is running at twice its own declared ceiling, and nothing is
watching.** No option on this panel's table addresses it, because none of them
refuses a call.

## Why the majority still chose `wiring-only`, and why it loses here

`evidence` and `adoption` reach `wiring-only` on the grounds that the code
reading is correct — `refreshIntervalMs` genuinely takes no ceiling — and that
passing a value already in hand costs almost nothing.

**Both are right, and neither computed the output.** `outcome` was the only lens
asked to, and the arithmetic is not a matter of judgement: a saturated clamp
cannot move. **A true reading of the code is not a reason to ship when the
output provably cannot change.**

This is the same failure this plan has now shown three times — a correct local
reading generalised into a benefit nobody measured. The moderator's own headline
measurement was overturned twice by the same command. **The pattern is the
finding.**

## The decision this panel supports

**Ship neither. Reject the plan and record what the panel measured.**

The plan's code reading survives and is worth keeping in the record:
`refreshIntervalMs` takes one rate field and no ceiling. But it is a gap with no
consequence while the cadence is clamped at 8× on every live connector.

**Three candidates that would move an observable number**, in order, none of them
this plan:

1. **The board is clamped, not tuned.** `MAX_CADENCE_STRETCH = 8` is where every
   connector sits; revisiting it is the only change that alters the board's own
   cadence today.
2. **Attribute the 721/hr to its real spenders.** The board is 0.75% of it and
   the record already carries per-caller lines.
3. **`plot-pm` at 203% of its ceiling**, unwatched.

**The operator's complaint is real and this plan was never aimed at it.**

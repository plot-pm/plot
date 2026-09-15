# Panel round 2 — a-connector-declares-its-ceiling

Subject: `docs/plans/2026-09-15-a-connector-declares-its-ceiling.md` (Draft)
Lenses: premise, regression, alternative. Reconciliation: **unanimous — amend**.
Round 1's moderation is in `panel.md`; these jurors judged the amended text.

## The correction is as false as what it replaced — and this time it is the panel's number

**All three jurors, independently, re-ran the command. The moderator re-ran it
three more times.**

Round 1 found the plan's headline reading false and the amendment replaced it
with one labelled *"Re-measured live"*: `limit: 5000, basis: actual`. Live now,
six consecutive runs:

```json
{"connector":"github","perHour":146.66,"limit":null,"remaining":null,"basis":"unknown"}
```

**That is the ORIGINAL plan's reading — the one round 1 declared false and the
amendment deleted as a "false section".**

**Neither reading was an error. Both were true when taken.** `premise` and
`alternative` measured the ledger: GitHub reports `actual` on **42 of 73,097
lines — 0.06%**. The moderator confirmed the same distribution.

**The mechanism is self-evicting**, and the amendment's own Notes name it without
applying it: a reading announces the reset window that then evicts it
(`plot-budget.sh:264-265` opens the window at the latest passed reset), so the
field oscillates on roughly an hour.

> **Round 1's moderator re-derived the plan's number and caught it. Nobody
> re-derived the correction — including the moderator who wrote it.** A plan
> resting on a 0.06% sample stated as standing fact, twice, in opposite
> directions.

**A single reading of this field is not evidence.** Any future claim about it
must state the frequency.

## The reading round 1 asked for was finally taken — and it decides against the plan as scoped

Round 1 said *"one command decides which plan to write"* and it was never run.
`premise` ran it. **Bitbucket, live on this machine, account `quatico`:**

```
771/hr against a declared ceiling of 1000 = 77%
40,112 ledger lines · 770 of 770 in-window lines carry the ceiling
```

**This is the first artefact on this estate corroborating "bb polls too hard".**
It falsifies two sentences still in the amended Notes — *"no artefact on this
estate records it"* and *"no Bitbucket cadence is observable here"*.

**And it decides against the plan's own shape.** Bitbucket needs **no
declaration**: `plot-host.sh:1984` already supplies `1000 predicted`, and 100% of
its in-window lines carry it. So the plan's first and only named beneficiary does
not need the config key that is its headline feature. What is justified is
passing `limitReadingOf(entry)` beside `rate` — **no config key, no fourth basis,
no new vocabulary.**

## The plan bypasses the exact guard written against it

`regression`'s finding, and it is structural.

`fleet.ts:1789` normalises any unrecognised basis to `unknown`, its comment
**literally predicting** *"a record written by a newer Plot could name a fourth
word"*. `LimitBasisSchema` (`limit.ts:26`) is a closed three-enum. **The plan
proposes a fourth basis, `declared`, and names neither.**

Both routes fail:

- **Through `spend-rate`** → silently discarded by that guard. The plan is a no-op.
- **Through `## Plot Config`** (which is what the slice line says) → **guard
  bypassed by construction.** `boundFromLimit` rejects only
  `basis === 'unknown' || limit === null`, so `declared` passes and 1000 →
  `floor(1000/900)` = **1** = `MIN_CONCURRENCY`.

Round 1's warning, now arithmetic: **any ceiling below 900 yields 1.**

## The new gate is necessary and insufficient, on three counts

The *"an interval ACTUALLY MOVES"* gate does close round 1's hole — it refuses
the 240000-for-every-ceiling variant. What remains:

- **It pins the wrong subject.** `boundFromLimit` is a pure function that cannot
  fail; the regression is *a new caller constructing a new reading*. The gate is
  green on the exact change it should refuse. The right subject is
  `prConcurrencyBound(entry)` at `fleet.ts:1642`.
- **Nothing pins the ratchet.** `applyReaction` (`fleet.ts:1594`) seeds
  `prConcurrency` from `boundFromLimit`, and `loweredConcurrency` **only ever
  falls** — so one refusal during a flickering-ceiling window pins the board at 1
  **for the process lifetime**, and fixing the config does not recover it. Only a
  restart does.
- **"Different" is not "slower".** The prose says slower; the gate says two
  different numbers, satisfied by 1 ms and by the wrong direction —
  `cadence.ts:143-147` says a board may only ever be slowed. *"Near its ceiling"*
  has no threshold, and **nothing gates the `unknown` path, which is GitHub's
  standing state 99.94% of the time.**

## The two policies compound, by design

Cadence stretches up to **8×**; concurrency serialises and adds up to 30 s of
`withHostSlot` polling per call. The feature's goal is *low ceiling → poll
slower*, and a low ceiling already means *call less concurrently*. **So a low
ceiling slows the board twice for one reason.** *"Does not change the stretch
policy"* does not prevent this: the compounding is two rules reading one input,
not a changed constant.

## Two further corrections to the amended text

- **"All three connectors declare one" is two of three.** `budget_reading`
  (`:1983-1986`) has **no jenkins arm** — `bitbucket)` then `*) unknown`. The 60
  at `:3760` belongs to the separate metered `limit` op, which `spend-rate` never
  consults. Verified by the moderator.
- **The named alternative is closed, and not the way the plan left it.**
  `alternative` simulated removing the `plot-budget.sh:281-283` unknown-filter
  against the live ledger: **zero `actual` lines exist in the window for a
  relaxed filter to stop dropping.** The plan was right to decline it; its stated
  reason — *"may be the whole defect"*, left open — is wrong, and one awk run
  closes it. `regression` reached the opposite conclusion from the same file and
  called it strictly dominating; **that disagreement is named rather than
  averaged, and the simulation settles it against `regression`.**

## The shared blind spot

All three verified every code claim and **all three initially accepted the
amendment's framing that the ceiling reaches the board**. `premise` broke it:
*"the board reads it and spends it on concurrency"* is **misleading** —
`boundFromLimit` returns null on `unknown`, so **GitHub is unbounded on 99.94% of
readings.** The amendment corrected round 1's error and inherited its optimism.

## What this panel asks for

1. **State the frequency, never a single reading.** 0.06% on GitHub.
2. **Re-premise on Bitbucket** — stable, 77% saturated, ceiling present on 100%
   of lines — and demote the GitHub oscillation to a finding.
3. **Split the wiring from the declaration.** Carry a ceiling to the cadence in
   **its own parameter**, never inside a `LimitReading`, and pin that separation
   structurally. The declaration may not be needed at all.
4. **Correct the Jenkins claim** and the two falsified Notes sentences.
5. **Gate `prConcurrencyBound`, not `boundFromLimit`**, and pin the ratchet.
6. **Make the movement gate directional, with a threshold**, and gate the
   `unknown` path.
7. **Measure what interval the Bitbucket board actually runs at** before changing
   the rule — `targetStretch` may already be returning `MAX_CADENCE_STRETCH` at
   771/hr, and nobody has looked.

**Not dispatchable.** The one-line wiring is justified and the measured Bitbucket
saturation is the best evidence this plan has ever had — but its headline number
has now been overturned twice by the same command, and the config key at its
centre is not needed by the only connector shown to need help.

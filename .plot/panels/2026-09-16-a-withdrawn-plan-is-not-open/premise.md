# Premise lens — a-withdrawn-plan-is-not-open

Position: amend

Every structural premise holds. Two citations are wrong in ways that are cheap to
fix, and **one gate is arithmetically unreachable as written** — measured, not
argued.

---

## 1. Is the problem real, and is it stated correctly?

**The problem is real.** I re-derived every measurement rather than accepting it.

### The quoted code is as quoted

`packages/domain/src/rules/phase.ts:139-152` — `planStatus` begins at line 140 as
the plan says, and the `default:` arm is verbatim:

```
140:export const planStatus = (readings: PlanReadings): PlanStatus => {
141:  switch (readings.phase) {
...
150:    default:
151:      return readings.review === 'pr' ? 'open' : 'draft';
```

### The parser citation is exact

```
$ sed -n '370p' skills/plot/scripts/plot-plan-meta.sh
    if (t ~ /^(draft|design|approved|delivered|released|rejected|superseded)$/) return t
```

Confirmed end to end on a real file — a rejected plan reaches the rule as the
word `rejected`, so it falls through `default:`:

```
$ skills/plot/scripts/plot-plan-meta.sh docs/plans/2026-08-31-the-board-answers-while-it-scans.md
{"file":"...","phase_raw":"Rejected","phase":"rejected",...,"review":"pr",...}
```

### The counts hold

```
$ for p in docs/plans/*.md; do grep -m1 -i '^- \*\*State:\*\*' "$p" | sed 's/.*State:\*\* *//'; done | sort | uniq -c | sort -rn
 264 Released
  11 Delivered
   8 Rejected
   3 Superseded
   1 Draft
```

**8 Rejected + 3 Superseded = 11. Confirmed.** `fe39198e` is real and its commit
message states the 14 → 11 transition itself; it moved three non-plans to
`docs/notes/`.

### The derivation path to the counter is confirmed

`fleet.ts:6867 estateTotals` → `board.ts:2231 planStatusBySlug` →
`board.ts:995 planStatus` → `decidePlanStatus` (the domain rule). In
`estateTotals`, **both** `draft` and `open` increment `counts.open`:

```
case 'draft':
case 'open':
case 'approved':
  counts.open += 1;
```

So the defect is real, and slightly broader than the title implies: 10 of the 11
withdrawn plans are `Review: in-session` and therefore report `draft`, not
`open`. Only ONE (`the-board-answers-while-it-scans`, `Review: pr`) actually
reports `open`. The user-visible *count* is right; the per-card *status word* the
plan also promises to fix is `draft` for 10 of 11.

**This is a statement defect, not a substance defect** — the fix (a case for both
phases, ahead of the `default:` arm) is correct for both.

---

## 2. Right fix, or a symptom?

**Right fix, and at the right layer.** The `default:` arm is the actual origin:
it is a catch-all standing in for four named phases. Adding a case ahead of it
treats the cause. Counting `rejected` out at `estateTotals` instead would be the
symptom fix, and the plan explicitly does not do that.

The "second half of a shipped one" framing is **verified true**, and the shipped
half is a genuine model:

```
$ sed -n '43p' packages/domain/src/entities/sprint.ts
export const ItemStatusSchema = z.enum(['done', 'open', 'disputed', 'withdrawn']);
```

`sprint.ts:43` is exact. `scoreItem` (`sprint.ts:125`) reads
`delivered === 'withdrawn'` FIRST, and `plot-sprint-release.sh:136` maps
`rejected|superseded) printf 'withdrawn'`. Two phases, one word — precisely the
collapse this plan proposes, already shipped and corpus-tested.

**Crucially the two derivations are independent**, which I verified rather than
assumed: the sprint side reaches `withdrawn` through `plan_delivery()` reading
the phase in shell, never through `PlanStatus`. So this plan genuinely cannot
regress the sprint scorer, as it claims.

---

## 3. Does `Done when` contain a gate immune to plumbing-through?

**Yes — and the plan is self-aware about exactly this.** It says the count is
*"asserted as a number rather than as a property, since every other gate here is
satisfiable by plumbing a value through and never counting it."* That reasoning
is correct and is the strongest thing in the plan.

A value added to `PlanStatusSchema`, returned by `planStatus`, and never handled
in `estateTotals` still lands in `default: continue` — counted in no bucket and
not in `total`. The count gate catches that; a type-level gate would not.

**But this gate is the one that is wrong.** See Q4.

---

## 4. What I could not verify, or found false

### FALSE (material): "the estate count falls from 11 open to 0"

I ran the real derivation:

```
$ node skills/plot/scripts/board/plot-ask.mjs fleet
estateTotals: {"total":288,"open":12,"wip":0,"done":276}
```

**The live count is 12, not 11.** The twelfth is **this plan's own file**, which
is on `origin/main` at `State: Draft`, `Review: in-session`:

```
$ for p in docs/plans/*.md; do s=$(grep -m1 -i '^- \*\*State:\*\*' "$p" | sed 's/.*State:\*\* *//'); [ "$s" = "Draft" ] && echo "$p"; done
docs/plans/2026-09-16-a-withdrawn-plan-is-not-open.md

$ git cat-file -e origin/main:docs/plans/2026-09-16-a-withdrawn-plan-is-not-open.md && echo "YES on origin/main"
YES on origin/main
```

So the gate is unreachable in both directions:

- It says the starting number is 11. **It is 12.**
- It says the ending number is 0. **It cannot be**, because a live Draft plan
  correctly counts as open, and this plan is one. While this plan is in Draft the
  floor is 1; once it is Approved it becomes `approved` — still `counts.open`.
  The number only reaches 0 after this plan is Delivered, which is after the
  branch has to satisfy the gate.

**This is the classic shape this estate rejects plans for**: a measurement taken
before the plan file existed, then asserted as a post-condition. The fix is
small — state the gate as *"the 11 withdrawn plans leave the open bucket; the
count falls by 11, and the remainder is exactly the plans that are genuinely
live"*. A delta is checkable on the branch; an absolute 0 is not.

### FALSE (minor): the function name `phaseOfPlanState`

The plan attributes the "null rather than a default" argument to
`phaseOfPlanState`, *"100 lines above it in the same file"*.

```
$ grep -rn "phaseOfPlanState" packages/ skills/ docs/
docs/plans/2026-09-16-a-withdrawn-plan-is-not-open.md:49:...
```

**The only occurrence on the estate is the plan's own sentence.** No such export
exists. The function is `toBoardPhase`, at `phase.ts:41` — 99 lines above, and
the quoted docstring is otherwise **verbatim correct** at lines 33-35.

The argument survives intact; only the name is invented. Still worth fixing —
this repo's own rule is that a citation names the thing.

### TRUE: every consumer claim

```
$ grep -rn "Record<PlanStatus" packages/
(none)

$ grep -rln "PlanStatus" packages/*/src/
packages/board/src/contract/schema.ts
packages/board/src/server/board.ts
packages/board/src/server/fleet.ts
packages/domain/src/rules/phase.ts
```

**Four files, no exhaustive map.** Confirmed — so no compile error will flag a
missed site, which makes the count gate load-bearing rather than belt-and-braces.

`board.ts:1978` is confirmed the one value comparison:
`const deliverable = status === 'deliverable';`. Other `'deliverable'` hits are
comment text (`schema.ts:531,533`, `board.ts:1970,2092`) or the unrelated
`ask.question === 'deliverable'` CLI verb (`entry/main.ts:78,110`,
`entry/ask.ts:127`) — a different enum. **The plan's claim is precise.**

### TRUE: the schema claims

`schema.ts` carries the seven-row table; the `draft` row reads exactly
`phase draft, no plan PR`; `reviewing` is `DELIBERATELY ABSENT` with its
paragraph. All verbatim. The plan's *"an absence with no argument beside it is a
gap"* is a fair reading of that file's own standard.

### TRUE: the sibling-plan claim

```
$ grep -n "planStatus\|estateTotals" docs/plans/2026-09-07-a-withdrawn-item-is-not-open.md
ZERO MENTIONS
```

And its own measurement reads *"three Rejected and three Superseded"* (line 38) —
so the estate has genuinely grown past what that plan measured. **Confirmed on
both halves.**

### TRUE: the release gate is untouched

Baseline captured for the branch to compare against:

```
$ skills/plot/scripts/plot-release-gate.sh
{"pass":true,"reason":"","detail":"","openShoulds":[],"openCoulds":[],
 "withdrawn":["[a-connector-declares-its-ceiling] — withdrawn (sprint ...)",
              "[a-complete-page-is-not-truncated] — withdrawn (sprint ...)"]}
EXIT=0
```

`release.ts:179,186` reads `ItemStatus`, never `PlanStatus`. The plan's *"the
release gate reads phase"* is loose wording — it reads `ItemStatus`, derived from
the phase in shell — but the conclusion (this change cannot move it) is right.

---

## 5. What a premise reader would notice that the plan missed

**1. The plan's own file is in the population it counts.** This is the finding.
A plan that asserts an estate-wide number must account for itself, because
writing the plan changes the number. Nothing in the document notices this.

**2. The `14` in the opening sentence is already stale.** The Design section
opens *"the board reports `14 open`"*. It reports 12, and `fe39198e` — already on
main, the commit directly before this plan — is what changed it. The plan
narrates the 14 → 11 move in prose but still leads with 14 as a present-tense
reading. State the number you measured, with the date.

**3. 10 of 11 report `draft`, not `open` — and the title says otherwise.** The
title, the changelog line, and the Design heading all say *withdrawn reads as
open*. For 10 of the 11 it reads as `draft`, because they are `Review:
in-session`. Only one is literally `open`. The bucket is shared so the count is
unaffected, but a card-level assertion written as *"these say open today"* will
fail against 10 files. Worth one sentence, since the plan does promise the card's
status word changes.

**4. `total` is not currently the sum of the buckets, and the gate assumes it
is.** Measured: `total: 288, open: 12, wip: 0, done: 276` — 12+0+276 = 288, so it
holds today. But it holds *by construction* only because `default: continue`
skips `counts.total += 1` too. A `withdrawn` case that increments `total` without
a bucket breaks the invariant `SprintCountsSchema` documents; one that increments
neither keeps it but silently shrinks `total` from 288 to 277. **The plan does not
say which it wants**, and both satisfy *"total still equals the sum of its
buckets"*. This is the one genuine design question left open, and the Done-when
gate as phrased cannot distinguish the two answers.

---

## What would make this proceed

Three edits, none structural:

1. **Restate the count gate as a delta**, measured on the branch: 12 → 1 while
   this plan is Draft, or *"the 11 withdrawn plans leave `open`"*. Not an
   absolute 0.
2. **Fix the citation**: `toBoardPhase` at `phase.ts:41`, not `phaseOfPlanState`.
3. **Say what happens to `total`** — a fourth bucket, or excluded from `total`
   the way unknown statuses already are.

The premise is sound, the fix is at the right layer, and the sibling plan really
is the model. What fails is the one number the plan chose as its strongest gate.

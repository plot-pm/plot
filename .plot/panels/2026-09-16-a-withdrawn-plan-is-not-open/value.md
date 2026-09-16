# Value lens — a-withdrawn-plan-is-not-open

Position: proceed

## 1. Is the problem real, and is it stated correctly?

**Real, and the arithmetic is correct. One word in the framing is wrong.**

Re-derived the estate census myself:

```
$ for f in docs/plans/*.md; do grep -m1 -E '^\s*-?\s*\*\*State:\*\*' "$f" | sed 's/.*State:\*\*\s*//'; done | sort | uniq -c | sort -rn
 264 Released
  11 Delivered
   8 Rejected
   3 Superseded
   1 Draft
   1 (blank)
```

8 + 3 = **11**. The plan's number holds. I chased the blank one:
`2026-09-09-the-ci-key-carries-its-instance.md` uses `**Phase:** Released`, not
`State:` — it is Released, not an uncounted twelfth. And `fe39198e` really did
move three non-plans to `docs/notes/`, which is the 14 → 11 step:

```
$ git show --stat fe39198e
 docs/{plans => notes}/2026-08-18-the-repair-exists-report.md
 docs/{plans => notes}/2026-08-23-an-eligible-wave-starts-itself-notes.md
 docs/{plans => notes}/kanban-board-v1-open-questions.md
```

`planStatus` is quoted verbatim and correctly (`rules/phase.ts:140`): the
`default:` arm catches `rejected` and `superseded` and answers
`review === 'pr' ? 'open' : 'draft'`. `plot-plan-meta.sh:370` does emit both by
name, as claimed.

**The one correction — and it strengthens the plan rather than weakening it.**
The title and the operator quote both say *open*, but 10 of the 11 are
`Review: in-session`, so they currently report `draft`, not `open`:

```
$ for f in docs/plans/*.md; do s=$(grep -m1 '\*\*State:\*\*' "$f" | sed 's/.*State:\*\*\s*//'); case "$s" in Rejected|Superseded) echo "$s | $(grep -m1 '\*\*Review:\*\*' "$f" | sed 's/.*Review:\*\*\s*//')";; esac; done
Superseded | in-session   (x3)
Rejected   | in-session   (x7)
Rejected   | pr           (x1)
```

Only `the-board-answers-while-it-scans` reaches `'open'`. The counter still reads
11 because `estateTotals` (`fleet.ts:6873`) buckets `draft`, `open` and
`approved` **all** into `open`. So the visible symptom is right, but the cause is
one level up from where the prose points — and it means fixing only the `'open'`
branch would fix 1 of 11. The plan's actual slice text ("give `planStatus` a case
for the `rejected` and `superseded` phases") gets this right; the narrative
around it is loose. Worth tightening, not a reason to stop.

## 2. Right fix, or a symptom?

**Right fix, and I checked the cheaper alternative I was asked to argue for.**

The decisive finding is 60 lines above the broken function in the same file:

```
$ sed -n '41,55p' packages/domain/src/rules/phase.ts
export const toBoardPhase = (helperPhase: string, _started = false): Phase | null => {
  switch (helperPhase) {
    case 'draft':     return 'Discovery';
    ...
    default:          return null;       // <- rejected/superseded land here
```

and `board.ts:1956`:

```
const mapped = toBoardPhase(meta.phase, started);
if (!mapped) continue;
```

**A withdrawn plan already renders no card.** The estate counter is the *only*
surface where those 11 appear. So the two derivations over the same phase field
already disagree: the column mapper says *not a phase I know*, the status rule
says *draft*. That is a genuine internal inconsistency in one file, not a
cosmetic count — and it is exactly the inconsistency the plan cites, with the
docstring it quotes (`null` rather than a default …) sitting immediately above
`PlanStatusSchema`. The quotation is accurate.

**Against the archive-directory alternative I was asked to price.** It is cheaper
(zero code) and I expected to prefer it. I do not, for three measured reasons:

- **It does not fix the counter.** `planStatusBySlug` (`board.ts:2244`) reads the
  estate via `collectPlanSources(refs, repoRoot, planDir, origin/main)` — the
  whole plan directory off the ref. Moving files to `docs/archive/` changes the
  path, so they'd drop out of the scan and the count would read 0 — by making
  the plans *invisible*, not by making the answer *right*. The rule that answers
  `draft` for a rejected plan would still be there, still wrong, and would fire
  again on the next rejection while the plan is still in `docs/plans/`.
- **The blast radius is larger than the code change.** 18 shell scripts read the
  `Plan directory` key; 372 references to `docs/plans` exist across
  `packages/`, `skills/` and `scripts/`. And inbound markdown links break —
  `a-connector-declares-its-ceiling` has 3 inbound references today. The `fe39198e`
  precedent moved **3** files and had to fix **4** links; scaling that to a
  recurring population is a maintenance tax, not a one-time tidy.
- **It contradicts the estate's own convention.** Delivered and Released plans
  are far more "finished" than a rejected one and they stay put — 264 Released
  files sit in `docs/plans/`. `active/` and `delivered/` are *symlink indexes*
  over the one directory, not a move. An archive dir would be the first real
  relocation and would need its own design argument.

The archive move is the right tool for files that **are not plans** (what
`fe39198e` did). A rejected plan *is* a plan; it has a lifecycle record, a
reason and a person. Deleting it from the reader's view is a worse answer than
naming its state.

## 3. Is there a gate that plumbing-through cannot satisfy?

**Yes — and the plan says out loud why it wrote it that way.**

> *the estate count on this repository falls from 11 open to 0, asserted as a
> number rather than as a property, since every other gate here is satisfiable by
> plumbing a value through and never counting it*

That is the correct instinct and it is the discriminating gate: you can add
`withdrawn` to the enum, return it from `planStatus`, and the count stays 11
unless `estateTotals`'s switch is actually changed — its `default: continue`
would swallow the new member and, worse, silently drop it from `total` too. A
second gate backs it: `total` still equals the sum of its buckets *with the new
one included*. Plumbing a value through and not counting it fails both.

Two supporting gates are real but weaker (satisfiable by doing nothing):
`status === 'deliverable'` at `board.ts:1978` unchanged, and the release gate's
verdict unchanged. Those are regression locks, correctly labelled as such.

**One caution on the "11 → 0" gate.** Asserting a live-repo number couples a test
to the estate census. The 11 becomes 12 the next time somebody rejects a plan,
and the test goes red for a reason that is not a defect. The existing suite
builds fixture plan files instead (`fleet-sprints.test.ts:81` writes
`2026-W40-fixture.md`). **Amendment worth making without re-opening the plan:**
assert the 0 over a *fixture* estate of known composition, and keep the live
repo reading as a one-off recorded measurement in the commit message. That
preserves the anti-plumbing property (the count must actually move) without the
brittleness.

## 4. Claims I could not verify, or found false

Everything load-bearing checked out. Specifically verified:

| claim | result |
|---|---|
| 14 → 11 via `fe39198e` | **true** — 3 non-plans moved |
| 8 Rejected, 3 Superseded | **true** |
| `plot-plan-meta.sh:370` names both phases | **true** |
| no `Record<PlanStatus, …>` anywhere | **true** — `grep -rn "Record<PlanStatus"` → 0 |
| exactly one consumer compares a status | **true** — `board.ts:1978`, `status === 'deliverable'`; the other hits are comments |
| four files name `PlanStatus` | **true** — `schema.ts`, `fleet.ts`, `board.ts`, `rules/phase.ts` |
| columns are `Phase`, not `PlanStatus` | **true** — `phaseDateOf`, `board.ts:1075` |
| sprint side shipped `withdrawn` | **true** — `entities/sprint.ts:43`, mapped from Rejected/Superseded at `:91` |
| the quoted `phaseOfPlanState` docstring | **true**, verbatim, and it is in the same file |

**Two things I'd call imprecise rather than false:**

- *"the board reports `14 open` and the correct answer is 0"* — the board reports
  a bucket labelled `open` that contains `draft`. Per §1, 10 of 11 are `draft`
  internally. The rendered string is `N plans · N open · …` (`SprintFilter.tsx:63`),
  so the operator did read the word "open"; the internal value differs.
- *"`phaseOfPlanState`, 100 lines above it"* — the function is named
  `toBoardPhase` (`:41`), ~99 lines above `planStatus` (`:140`). The docstring
  quoted is real and is that function's. A wrong name, not a wrong argument.

## 5. What my lens notices that the plan missed

**(a) The benefit is smaller than the plan implies, and the plan should say so.**
Asked to find who reads the counter: there is **exactly one consumer**.

```
$ grep -rn "estateTotals" packages/board/src
schema.ts:3998            (field)
SprintFilter.tsx:50,74,92,94,108,175   (render)
AgentList.tsx:730         (pass-through)
fleet.ts:6867,6930,7101   (compute)
```

It is a text label in the sprint filter — `Total — 278 plans · 11 open · …` —
shown when the filter is OFF. It **gates nothing**, branches nothing, and
schedules nothing. The plan is right to say "it does not gate anything", but it
frames that as a safety property when it is equally a *value ceiling*: the
decision this changes is a human glance. The honest benefit is "a label a reader
can trust", not "the board knows how much work is outstanding".

**(b) But the problem RECURS, which is what settles it for me.** This was the
question I was asked to answer and it has a measurement:

```
$ for f in docs/plans/*.md; do ... done | cut -c1-7 | sort | uniq -c
   5 2026-08
   6 2026-09
```

Five withdrawals in August, six in September — and five of those landed on a
single day, 2026-09-15. At ~5–6/month against a 278-plan estate, the counter
re-breaks every few weeks. Tidying handles a one-off; this is a rate. That is
the difference between "move three files" (correct for `fe39198e`, which
addressed a genuinely one-off population of non-plans) and a rule change. The
plan is the second half of a shipped idea, not a new one, and the first half
(`a-withdrawn-item-is-not-open`, v2.15.0) already paid the design cost.

**(c) The cost is genuinely tiny, and I verified it rather than trusting it.**
No exhaustive map, one comparison site, four files, no plan-format change, no
script change, no column change. This is perhaps an hour. Against a defect that
recurs monthly and an already-shipped vocabulary to copy, the ratio is fine even
with a modest benefit. My reservation is about the *framing*, not the *spend*.

**(d) The claimed benefit IS measurable after it lands — better than the plan
realises.** The plan offers the count falling to 0. There is a stronger and more
durable one it does not name: **`toBoardPhase` and `planStatus` currently give
different answers for the same phase field**, and after this lands they agree —
`toBoardPhase` returns `null` (no card) and `planStatus` returns `withdrawn`
(counted outside the three buckets). That is a property over the rule pair, not
a census of today's estate, so it survives the next rejection. It is also the
argument that makes the fix structural rather than cosmetic, and it belongs in
the Design section.

**(e) A gap the plan explicitly defers, correctly.** It says it "does not decide
what a withdrawn card looks like". Given `toBoardPhase` already suppresses the
card entirely, the answer is effectively decided: a withdrawn plan is invisible
on the board and appears only in a count that will now exclude it. That means
after this lands, **the 11 become invisible everywhere**. For a rejected plan
that is right. It is worth one sentence acknowledging it, so nobody later reads
the disappearance as a regression.

**Summary.** Modest benefit, honestly small surface, but a recurring defect, a
near-zero cost, a shipped precedent to copy, and a real internal contradiction
between two rules in one file. The archive alternative is cheaper and worse — it
hides the population instead of naming it, breaks links, and leaves the rule to
misfire again next month. Proceed, with the fixture-not-live-number amendment
in §3 and the framing corrections in §1 and §5(d).

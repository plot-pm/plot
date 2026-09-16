# Semantics lens — a-withdrawn-plan-is-not-open

Position: amend

Lens: vocabulary. Whether `withdrawn` is the right word, whether one word is made to carry two subjects, whether `rejected`/`superseded` should collapse, and whether `PlanStatus` survives gaining a terminal non-outcome.

---

## 1. Is the problem real, and stated correctly?

**Real. The central numbers re-derive exactly.**

```
$ for f in docs/plans/*.md; do grep -m1 -E '^\s*-?\s*\*\*State:\*\*' "$f" | sed 's/.*State:\*\* *//;s/ *$//'; done | sort | uniq -c | sort -rn
 264 Released
  11 Delivered
   8 Rejected
   3 Superseded
   1 Draft
   1            (one file with no State: line)
```

8 + 3 = **11**, as claimed. And `fe39198e` is real, and its own message says *"the estate's open count falls from 14 to 11"* — so 14 → 11 is verified from git, not from the plan's assertion.

The mechanism is real and I traced it end to end. Two different loops read `planStatus`:

- `board.ts:1956` — `const mapped = toBoardPhase(meta.phase, started); if (!mapped) continue;` — a **rejected or superseded plan produces no Card at all**.
- `board.ts:2273` (`planStatusBySlug`) — `bySlug.set(planSlug(relPath), planStatus(meta, pulse, complete))` — **no `toBoardPhase` filter**. Every plan file is counted.

`estateTotals` (`fleet.ts:6873`) then buckets `draft` into `open`. Confirmed `toBoardPhase` returns `null` for both phases:

```
$ node /tmp/t.mjs
rejected -> null   superseded -> null   (empty) -> null
```

**So the defect is precisely located, and it is narrower than the plan says.** See §4.

**Where the statement is wrong on my lens:** the plan says `default:` catches `design` "beside" `rejected|superseded`. It does — but `design` is not a defect there. `toBoardPhase('design') → 'Design'`, so a design plan gets a card, and `planStatus` calling it `draft`/`open` is arguably correct: a design plan IS out for approval. The estate holds **0** design plans anyway (`grep -rln "State:\*\* Design" docs/plans/ | wc -l` → `0`). The plan lists it as a co-symptom and then does not fix it, which §3 of my answer treats as defensible but under-argued.

---

## 2. Right fix, or a symptom?

**Right fix on the derivation; incomplete on the vocabulary, which is my objection.**

`planStatus`'s `default:` arm is genuinely the invented answer, and the plan's best argument is textual and I verified it: `toBoardPhase` sits 100 lines above in the **same file** and says

> `null` rather than a default: a state this does not know is a plan format the workflow does not understand, and putting it in Discovery would answer a question nobody could answer.

Answering `draft` for `rejected` is that same invented answer. So adding a case is right.

**But the plan proposes adding a VALUE where the file next door proposes `null`**, and it does not say why it diverges from the precedent it cites. `toBoardPhase` answers `null` for an unreadable phase; `planStatus` returns a total `PlanStatus`. A `withdrawn` member is a real design choice against that precedent, and the plan quotes the precedent as support without acknowledging it points a different way. That is an argument gap, not a defect.

**The deeper vocabulary issue.** `PlanStatus`'s own docstring reads:

> A plan's status, as a reader acts on it rather than as the file spells it.
> Finer than Phase: one phase can hold several statuses.

Both clauses break. `withdrawn` is **not finer than a phase** — `rejected` and `superseded` ARE phases the parser emits, and `withdrawn` is *coarser*: it collapses two phases into one status. Every existing member is either 1:1 with a phase or a refinement of `approved`. `withdrawn` is the first **many-phases-to-one-status** mapping in the enum, and the docstring asserts the opposite relation. It must be rewritten; the plan does not name it.

The schema's own table has the same problem and the plan under-scopes it. `schema.ts:325` reads *"The seven, and what each is measured from (`planStatus` in **`board.ts`**)"* — the rule moved to `packages/domain/src/rules/phase.ts` and the pointer is already stale. The plan says "gains its eighth row" and says nothing about the sentence above the table, which is wrong today and stays wrong after.

---

## 3. Does `Done when` contain a gate that plumbing alone cannot satisfy?

**Yes, and the plan says so explicitly and correctly.**

> **the estate count on this repository falls from 11 open to 0**, asserted as a number rather than as a property, since every other gate here is satisfiable by plumbing a value through and never counting it

That is the right gate and the plan names the right reason. A `withdrawn` value plumbed into `PlanStatusSchema` and returned by `planStatus` but never bucketed in `estateTotals` still reports 11 open — the assertion catches it.

Second real gate: `total` still equals the sum of its buckets **with the new one included**. This one is load-bearing beyond plumbing, and my lens found why — see §5's finding on `SprintCounts`.

**One `Done when` clause is weaker than it reads.** *"a plan in every other phase reports byte-identically to today, pinned across all seven existing values"* — this is satisfiable by a table test with seven rows, which is fine, but it does not pin the **one comparison that matters** independently. The `board.ts:1978` clause does cover that, so the set is adequate.

---

## 4. Claims I could not verify, or found false

**FALSE — the board-impact comment.**

> "every plan card whose plan is withdrawn gains a status nothing rendered before"

A withdrawn plan **has no card**. `board.ts:1956` runs `if (!mapped) continue` before `planStatus` is ever called, and `toBoardPhase` returns `null` for both phases. **No card is built, so no card gains a status.** The only reader affected is the estate counter via `planStatusBySlug`, which does not filter. This matters on my lens because the comment invents a rendering consequence that does not exist, and the plan's own "What this does not do" section then reasons about card rendering (*"whether such a plan renders in a column, in a fold, or not at all"*) as an open question, when the current answer is settled and is *not at all*.

**IMPRECISE — "Four files name `PlanStatus`".**

```
$ git grep -ln "PlanStatus" -- packages skills
packages/board/src/contract/schema.ts
packages/board/src/server/board.ts
packages/board/src/server/fleet.ts
packages/board/test/unit/plan-status.test.ts     <- fifth, a test
packages/domain/src/rules/phase.ts
```

Five, and the plan's list omits the test file — which is the file that must change most.

**VERIFIED — "no `Record<PlanStatus, …>` anywhere"**: `grep -rn "Record<PlanStatus"` over `packages/` returns nothing (exit 1). True; no exhaustive map catches a missed arm.

**VERIFIED — "exactly one consumer compares a status value"**: `board.ts:1979` `status === 'deliverable'` is the only `.status ===` on a `PlanStatus`. `TupleRow.tsx:784` renders a `tuple.status`, which is a branch/agent status string with its own vocabulary (`conflicts`, `checks failing`, `stalled`) and takes `statusTone(status: string)` — unrelated, and not a fourth `PlanStatus` reader. True.

**VERIFIED — the sprint scorer's vocabulary**: `entities/sprint.ts:43` is `z.enum(['done','open','disputed','withdrawn'])`, shipped with `PlanDelivery = boolean | 'no-plan-named' | 'withdrawn'` and a corpus test (`packages/domain/corpus/sprint-score.corpus.test.ts` exists). True.

**UNVERIFIED — "the release gate's verdict on this repository is unchanged, asserted by running it"** is a `Done when`, not a claim, so nothing to falsify. But I note `workflows/release.ts:179` already filters `i.status !== 'withdrawn'`, so the gate reads **item** status and never plan status. The gate is structurally untouchable by this change, which makes that assertion cheap rather than informative.

---

## 5. What my lens notices that the plan missed

### 5a. `withdrawn` now names two different subjects, and the plan does not say so

This is the question I was asked and the answer is: **the word is right, and the plan must state the doubling.**

- `ItemStatus.withdrawn` — a **sprint item**. Its docstring: *"somebody decided the plan will not deliver … it reports a decision the plan itself carries, which is why the checkbox cannot change it."*
- `PlanStatus.withdrawn` (proposed) — a **plan**.

This estate is strict about exactly this (CLAUDE.md: Slice vs Wave, Agent vs Worker, *"a design spec's terminology is binding"*). Two enums, two subjects, one word.

**I judge it defensible, and here is why it is not the Slice/Wave error.** Slice and Wave were two *different concepts* wearing one name. Here the concept is identical — *somebody decided this will not deliver* — applied to two subjects, and `ItemStatus.withdrawn` is **derived from** the plan's phase: `scoreItem` returns `'withdrawn'` exactly when `PlanDelivery === 'withdrawn'`, which `plot-sprint-release.sh:54` sets when *"the plan carries State: Rejected or Superseded"*. The item is withdrawn **because** the plan is. One meaning, propagated. The alternative — inventing a second word for the plan side — would be the real vocabulary defect, since the reader would then have to learn that `withdrawn` items come from `<other-word>` plans.

**But the plan must carry that argument and it does not.** It presents the sprint precedent as *"the second half of a shipped one"* and never asks whether reusing the word across subjects is legitimate. On an estate that documents `reviewing` as DELIBERATELY ABSENT with a paragraph, an eighth member arriving with no such paragraph is below the file's own standard. **Amendment: state that the subjects differ, that the meaning does not, and that the item's value is derived from the plan's.**

### 5b. `rejected` and `superseded` should stay two phases and collapse to one status — and the precedent already argues it

The argument exists verbatim, one scope away, and the plan never cites it. `entities/sprint.ts:98`:

> `Rejected` and `Superseded` arrive as ONE reading. They differ in **why**, which the plan's own `Rejected:` or `Superseded:` record states; the sprint's question is only whether the item is still owed, and neither is.

Substituting *estate counter* for *sprint* gives the correct answer for this plan verbatim: the counter's question is only whether the work is outstanding. **Collapse is right.** The plan should quote this rather than leave the reader to re-derive it — especially since `transitions/plan.ts` keeps them apart at every other layer (`PlanState` has both, `notLeavable(plan, 'rejected', 'rejected')` at `:714` and `:787` are separate transitions with separate record fields `Rejected:`/`Superseded:`), so a reader meeting one status over two phases will reasonably ask why.

### 5c. **`PlanStatus`'s stated contract breaks, and so does a live comment in `fleet.ts`**

Two pieces of prose become false and neither is in scope:

**(i) `rules/phase.ts:14`** — *"Finer than `Phase`: one phase can hold several statuses"*. `withdrawn` is the first status **coarser** than a phase (two phases → one status). The sentence must be amended; it is the type's definition.

**(ii) `fleet.ts:3824`**, live today on `deferredReason`:

> It answers a question `planPhase` cannot. **A withdrawn plan keeps `Phase: Draft` deliberately — Plot has four phases and none of them is *withdrawn***, and `the-board-answers-while-it-scans` says so in its own text … So the phase reads `draft`, the row says *plan not approved yet — still in review* … Measured on the live board 2026-09-02.

**That paragraph is already false on the estate** — 11 plans carry `Rejected`/`Superseded`, the parser matches them (`plot-plan-meta.sh:370`), and `PlanState` admits both. It documents a workaround this plan's premise supersedes. On this estate the convention is to **amend rather than quietly break** such a paragraph (CLAUDE.md does this twice by name for `plot-host.sh` and `plot-open-pr.sh`). The plan touches neither sentence.

### 5d. `SprintCounts` is shared, so a fourth bucket is not local to the estate

`estateTotals` returns `SprintCounts`, and **so does the per-sprint tally** (`fleet.ts:6804`, same four keys, same buckets). `SprintCountsSchema` documents *"Total non-deferred members. Always equals `open + wip + done`"*, and `SprintFilter.tsx:62`'s `formatCounts` renders `N plans · N open · N WIP · N done` for **both** — its own docstring says *"THREE BUCKETS … Every member lands in exactly one bucket … Estate totals and sprint numbers use the SAME bucket derivation, so they cannot disagree about what a bucket means."*

The plan says *"count it outside `open`/`wip`/`done` in `estateTotals`"* and stops. Two outcomes, and the plan chooses neither:

- **A fourth key** → `SprintCountsSchema` gains a field, the *"always equals open+wip+done"* docstring changes, `formatCounts` renders four buckets **for sprints too**, and `SprintFilter.tsx`'s THREE-BUCKETS docstring becomes false.
- **Drop it from `total`** → the estate total stops being the plan count, and `formatCounts`'s *"the sum is the total"* invariant silently means something different on the two rows it renders.

Either way the change reaches `SprintCountsSchema`, `SprintFilter.tsx` and the sprint tally at `fleet.ts:6804`. **The plan's four-file cost list names none of them.** Its own `Done when` — *"`total` still equals the sum of its buckets with the new one included"* — presupposes the first option without saying so, and a slice whose scope is `rules/phase.ts` + `schema.ts` + `estateTotals` cannot satisfy it.

On my lens this is the substantive amendment: **the vocabulary question `withdrawn` raises for `PlanStatus` also lands on `SprintCounts`, whose bucket names are a second vocabulary the plan treats as absent.**

### 5e. The `default:` arm is fixed for two of four cases, and the plan should say which two and why

The four cases the arm catches: `rejected`, `superseded`, `design`, and a file with no readable phase. The plan fixes two.

**Defensible, and better than the plan argues it.** `design` is not a defect (it maps to a real column; 0 on the estate). The **phase-less file** is the one the plan should name and does not: `fe39198e` removed three such files by moving them to `docs/notes/`, which is a *data* fix for what remains a *rule* gap — `planStatus` will still answer `draft`/`open` for the next unparseable file, and `planStateOf` already has the vocabulary for it (`'none'`, documented as *"unmeasured, not early"*). One file in `docs/plans/` today still has no `State:` line (the count above). The plan should say **why `none` is out of scope** rather than leave the reader to notice the arm is still inventing an answer for it. `plot-reconcile-scan.sh:736` already classifies *no phase field → not a plan*, so the estate counter having no such rule is a named gap, not a hypothetical.

---

## Summary

The defect is real and I re-derived every number. The word `withdrawn` is the right word and the two-subject reuse is legitimate — but only because the meaning propagates from plan to item, and the plan never makes that argument. What it must gain before approval:

1. Correct the board-impact comment: a withdrawn plan renders **no card** (`board.ts:1956`), so nothing gains a rendered status.
2. State that `withdrawn` names a plan here and an item in `entities/sprint.ts`, that the meaning is one, and that the item's value derives from the plan's.
3. Cite `entities/sprint.ts:98` for the `rejected`+`superseded` collapse instead of leaving it unargued.
4. Bring `SprintCounts`, `SprintFilter.tsx`'s three-bucket docstring and the sprint tally at `fleet.ts:6804` into the cost list — the `Done when` already assumes them.
5. Amend `rules/phase.ts:14` ("finer than Phase") and `fleet.ts:3824` ("Plot has four phases and none of them is withdrawn"), both of which this change falsifies.
6. Say why `design` and a phase-less file stay in `default:`.

None of these is a reason to reject. All six are things a reader of the schema's own standard — where `reviewing` gets a paragraph for being absent — would expect an eighth member to arrive with.

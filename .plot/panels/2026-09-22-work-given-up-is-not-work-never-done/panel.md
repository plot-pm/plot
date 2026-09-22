# Panel moderation — work given up is not work never done

**Subject:** `docs/plans/2026-09-22-work-given-up-is-not-work-never-done.md`
**Commitment:** `Position: proceed|amend|reject`
**Reconciliation:** `unanimous` — `amend=rule,consequence`. **2 of 2 gated. Nobody said proceed or reject.**

| Lens | Evidence | Position |
|---|---|---|
| rule | **Ran both final lines over nine plan shapes** | amend |
| consequence | **Parsed all 318 plans and traced every caller** | amend |

## What survives, and both jurors verified it by execution

**The defect is real and reproduces.** `allSlicesMerged` reaches its last line with `merged === 0` for an all-deferred plan and answers `not-merged`. The script answers the opposite:

```
plot-deliver.sh --dry-run  →  "0 branch(es) merged, 1 deferred" → would flip
```

**The one-line replacement is correctly scoped.** The rule juror ran old and new over nine shapes and found **exactly one case changes** — the all-deferred plan. The empty-plan and prose-heading guards both still refuse, and the mixed merged/unfinished case still returns `not-merged` at the `slice.verdict` test. The promised non-regression holds.

## Why it is amended: two findings, and one is a safety finding

### 1 · The change would auto-deliver two plans, unattended, and one of them is not finished

**`auto-deliver` is unconditional.** `maybeAutoDeliver` runs inside `refresh`'s success path on every landed scan, and its own docstring says *"There is no switch and no cap, which is a deliberate asymmetry with auto-dispatch rather than an omission."*

The juror parsed all 318 plans. Ten have only deferred slices; `planAutoDeliver` filters on `phase === 'approved'`, so **two would deliver on the next scan tick**:

```
approved   a-test-must-not-stop-the-fleet            → YES
approved   a-failed-tick-must-not-end-the-daemon     → YES
```

**The second is one this plan's own Notes flag as unfinished** — *"owes three corrections of its own and is not merely blocked on this."* The plan names a plan that is not ready and its change would deliver it automatically, without the person who owes those corrections being asked.

And the chain does not stop at delivery: deliver → reap → `plot-release-refs.sh --yes`, whose last link deletes remote refs, which `CLAUDE.md` names as the one action that is not re-creatable at all.

**This is the finding the plan had no way to see from the rule alone**, and it is why a consequence lens exists.

### 2 · `deferred` does not mean "work that landed"

The plan argues from four released plans that the shape means *built elsewhere*. The annotation admits any reason — given up, moved, superseded, shelved. **The fix admits a population wider than the one it argues for**, and the rejected and superseded plans in the ten are the proof that deferral is often abandonment rather than completion.

### 3 · There are three readers, not two, and a fourth duplicate

`plot-ask.mjs deliverable` already answers the plan's way:

```
{"merged":0,"deferred":1,"deliverable":true}
```

**So the defect is narrower than stated** — `allSlicesMerged`'s pulse path only, reaching the board's Deliver control and `auto-deliver`. That verb's separate arithmetic is a fourth undeclared duplicate of this rule which the plan does not mention and its proposed corpus pair does not cover.

## The author's error

**I reported a `POST /api/deliver` refusal and called it "two readers, one plan".** There are four implementations of this question on the estate and I found two. The one I did not look for already agreed with the script — which would have told me the defect was in one path rather than in the rule's intent.

## What the moderation recommends

**Amend. The rule change is right; it must not land alone.**

1. **Gate `auto-deliver` on this population, or land the two after it.** An all-deferred plan reaching `deliverable` is correct for the board's control and for `/plot-deliver`; reaching an unattended deliver-reap-delete chain is not. The simplest form: `planAutoDeliver` requires `merged > 0`, keeping today's behaviour for the automatic path while the manual one is fixed.
2. **Say what `deferred` means and scope the claim to it.** The plan argues *work that landed*; the annotation means *work not done here*. Both justify deliverability — a plan cannot wait forever on a branch nobody will build — but the plan should argue the second, which is what it is actually changing.
3. **Declare the corpus pair over all four readers**, not two. `plot-ask.mjs deliverable`'s arithmetic is the one that already disagreed and nobody noticed.
4. **Do not deliver `a-failed-tick-must-not-end-the-daemon` through this.** Its three owed corrections are a person's decision and predate this plan.

**Nothing is approved and nothing is dispatched.** The plan is Draft and stays Draft.

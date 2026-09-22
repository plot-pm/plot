# Rule lens — work given up is not work never done

Position: amend

The defect is real, the one-line replacement is correctly scoped, and the regression the plan promises not to cause it does not cause — I verified all three by execution. What it gets wrong is the *reason*: `deferred` does not mean "work that landed", and the estate proves it does not. The fix admits a population wider than the one it argues for, and the plan's own cited precedents disagree with each other.

## 1. Is the plan's reading of the defect accurate? — YES, and I reproduced it

`allSlicesMerged` (`packages/domain/src/rules/deliverable.ts:72-91`) is exactly as described. `merged` counts only non-deferred branches (`:74` filters, `:88` adds), so an all-deferred plan reaches `:91` with `merged === 0` and takes `not-merged`.

Reproduced on `a-test-must-not-stop-the-fleet`:

```
plot-plan-meta.sh  → waves[0].branches[0].deferred = true   (1 branch, all deferred)
plot-deliver.sh --dry-run
  → "step: verified 0 branch(es) merged, 1 deferred"
  → "would flip Phase → Delivered"    EXIT=0
```

The disagreement is genuine. The two readers see one annotation and answer oppositely.

**One correction to the plan's evidence.** The plan prints a `POST /api/deliver` refusal. `plot-ask.mjs` exposes no `deliver` verb — `usage: plot-ask.mjs <board|fleet> | deliverable <slug> <plan-file>`. And the verb that *does* exist already answers the plan's way:

```
$ node skills/plot/scripts/board/plot-ask.mjs deliverable a-test-must-not-stop-the-fleet <file>
{"merged":0,"deferred":1,"unmerged":[],"emptySlices":[],"deliverable":true,...}
```

**So there are three readers, not two, and the third already sides with the script.** The plan's framing ("two readers, one plan") is wrong in a way that matters: the defect is narrower than stated — it is `allSlicesMerged`'s pulse-based path only, reaching the board's Deliver control and `auto-deliver` (`deliver.ts:230`, `auto-deliver.ts:237,271`). The `deliverable` verb's separate arithmetic is a *fourth* undeclared duplicate of this rule, which the plan does not mention and its proposed corpus pair does not cover.

## 2. Does the replacement preserve the guard? — YES. I found no shape it wrongly admits

I ran both final lines over the same walk across nine shapes. **Exactly one case changes:**

```
old         -> new          case
not-merged  -> merged       A: all-deferred, one slice (the subject)   <== the only change
not-merged  -> not-merged   B: plan names NO slice at all (slices: [])
not-merged  -> not-merged   C: slice naming no branch (prose heading)
not-merged  -> not-merged   D: one merged slice + one unfinished
merged      -> merged       E: all merged
not-merged  -> not-merged   F: deferred slice + unfinished slice
not-merged  -> not-merged   G: deferred slice then empty slice
not-merged  -> not-merged   H: one slice: deferred + open branch
merged      -> merged       I: one slice: deferred + open, verdict 'complete'
```

The three cases the rubric names all hold:

- **Empty-slice case (B).** `slices: []` never enters the loop; `merged + deferred === 0`; `not-merged`. Preserved.
- **Prose-heading case (C).** `slice.branches.length === 0` returns at `:85`, *above* the counter. The counter was never the net for this — `:85` is, and the plan slightly overstates its own guard by calling the counter "the second net."
- **Mixed case (D).** Returns at the `slice.verdict !== 'complete'` test, before the counter is read.

**Case I is a pre-existing looseness, not one this plan introduces** — both versions answer `merged` for a slice carrying a deferred *and* an open branch whose verdict is nonetheless `complete`. That is `sliceVerdict`'s answer being trusted, and it is unchanged. I note it so it is not later misattributed to this change.

## 3. Is "nothing else in the rule moves" true? — YES

Verified by execution (case D above) and by reading. A plan with one merged slice and one unfinished slice returns `not-merged` at `:87`, before `:91`. The counter is only reached when every slice already passed its verdict test. The claim is accurate.

## 4. Is `deferred` the right thing to count? — NO. This is the amendment

**The plan's premise is that a deferred branch names work that landed.** `plot-plan-meta.sh` does not admit only that, and the estate falsifies it directly. Surveying every `deferred:`/`moved:` annotation in `docs/plans/`, the reasons split into two populations:

**Work that landed elsewhere** — `moved: landed on main as 88361492 before this plan was written`, `built directly on main 2026-09-22 (6d47cfa7a)`, `delivered by siblings 2026-08-26`, `absorbed by ... (PR #299)`.

**Work that was never built at all:**

| reason | plan | phase |
|---|---|---|
| `premise falsified 2026-08-26 — no 13px exists; nothing to build` | the-page-is-as-tall-as-the-screen | **Released** |
| `plan withdrawn 2026-08-31 — the blocker was found ... before this was built` | the-board-answers-while-it-scans | Rejected |
| `rejected by panel 2026-09-22 — the fix would make started agents undispatchable` | a-free-agent-is-not-a-finished-one | Superseded |
| `not measured as a live defect 2026-08-26 — re-measure before building` | — | — |
| `the shape is undecided — day-files, a window-bounded reverse read, or ...` | — | — |

The parser is explicit that this is intended: `plot-plan-meta.sh:958` records that `moved:` and `deferred:` are *the same answer*, and the domain says so in its own entity doc — `entities/fleet.ts:167`, **"A deferred Slice whose Branch does not exist is the case that proves neither derives from the other."**

**So `deferred` means *nobody is going to build this*, and whether anything landed is a separate fact the annotation does not carry.** After this change, `the-page-is-as-tall-as-the-screen` — whose sole slice says *"nothing to build"* — reads `merged`, i.e. *a plan whose work has landed*. That is the exact sentence the `merged > 0` guard was written to refuse, now false for a different reason.

**The plan's own precedent set is split on this, and it does not notice.** Of the four Released plans it cites as proof the script's reading is the estate's practice, three name a landing commit (`88361492`, `f9c8e151`, *"landed directly on main 2026-02-11"*) and the fourth is `premise falsified ... nothing to build`. The plan treats them as one population; they are two, and only three support it.

**The estate counts also do not reproduce.** The plan says *"ten plans have only deferred slices; four Released, one Rejected, one Superseded, two Approved and two Draft."* Measured across every plan with `plot-plan-meta.sh`: ten all-deferred plans, but **4 Released, 1 Rejected, 3 Superseded, 2 Approved, 0 Draft**. The total and the Released four are right; the tail is not. A plan whose method is *recount what a header claimed* — its sibling `a-test-must-not-stop-the-fleet` recounted 7-of-22 to 9-of-21 for exactly this reason — should get its own census right.

### What this does not do

It does not make the change unsafe to ship. `allSlicesMerged` is a measurement feeding a control a person presses, and `/plot-deliver` re-verifies merges independently. **But `auto-deliver` presses no button** (`auto-deliver.ts:237,271`), and after this change an all-deferred plan whose premise was falsified becomes auto-deliverable. That is a real widening and the plan neither names it nor argues it is acceptable.

## 5. What the plan does not consider

- **The third reader.** `plot-ask.mjs deliverable` already answers `deliverable: true`. The plan's "two readers" framing is wrong, and the corpus pair it proposes (domain ↔ `plot-deliver.sh`) leaves this duplicate undeclared — the same gap it is written to close.
- **The script does not refuse the empty case either, so "the script is right" proves less than claimed.** `plot-deliver.sh:208` reads `if [ "$merged_count" = "0" ] && [ -z "$deferred_count" ]` — *the plan's own proposed predicate* — and on hitting it prints `"no branches found in plan — proceeding (nothing to verify)"` **and continues**. The shell never refuses a plan that names no work; it warns (`:191-199`) and delivers. So the two sides are not "one right, one wrong" on one axis — they disagree on the all-deferred case *and* on the empty case, and the plan copies the shell's predicate while keeping the domain's stricter empty handling. That is defensible, but it is a third position, not the shell's, and the corpus pair will encode a disagreement on the empty case from the day it is written.
- **`Landed`'s documented contract goes stale.** `deliverable.ts:59-60` promises `'not-merged'` *"when the plan has no non-deferred branch at all"* and `'merged'` *"when every non-deferred slice is complete over at least one branch."* Both sentences become false. The TSDoc must move with the code; `deliver.ts:182`'s *"`allSlicesMerged`'s own `merged > 0` guard folds the empty case in here"* and `auto-deliver.ts:208`'s *"At least one branch actually merged"* also describe behaviour that will no longer exist. The plan says it does not touch `deliver.ts` — correct as to logic, wrong as to its comments.

## What would move me to `proceed`

1. **Re-argue the change on what `deferred` actually means.** The honest case is *a deferred branch is work nobody will do, so it is not outstanding, so it cannot hold up delivery* — which is already the scan's rule everywhere else and does not require claiming the work landed. That argument survives `premise falsified`; the current one does not.
2. **Name the widening.** State that an all-deferred plan whose work was never built becomes deliverable and auto-deliverable, and that this is accepted because a plan with nothing left to do is finished whatever the reason.
3. **Fix the census** (4/1/3/2/0, not 4/1/1/2/2) and drop or requalify `the-page-is-as-tall-as-the-screen` as a precedent — it is evidence against the stated premise.
4. **Correct the reproduction** to the verb that exists, and say the defect is `allSlicesMerged`'s pulse path only.
5. **Update the three TSDoc blocks** (`deliverable.ts:59-60`, `deliver.ts:182`, `auto-deliver.ts:208`) in the Done-when list.
6. **Decide the third reader**: either fold `plot-ask.mjs deliverable`'s arithmetic into the corpus pair or file it.

None of these changes the diff. All of them change what the diff is understood to mean, which for a rule whose comments are its contract is the part that outlives the commit.

Position: amend

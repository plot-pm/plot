# Panel moderation — an unasked host is not an absent PR

**Subject:** `docs/plans/2026-09-21-an-unasked-host-is-not-an-absent-pr.md`
**Commitment:** `Position: proceed|amend|reject`
**Reconciliation:** `unanimous amend` — domain, wire, vocabulary, evidence. **Four of four, gated.**

## What each juror actually looked at

| Lens | Evidence |
|---|---|
| domain | Read `quiet.ts` and its tests in full, then **traced every caller** through `fleet.ts` to the readings constructors |
| wire | Traced the three `AgentRow.quietKind` assignment sites and the client's cast path |
| vocabulary | Surveyed every existing word for not-knowing across the estate |
| evidence | **Tried to refute the core claim on the live repository and board**, and could not |

All three converged on the same place from three directions, which is the strongest signal this panel produced.

## The refutation attempt failed, and that is the panel's strongest result

The evidence juror's whole task was to destroy the central claim. It reproduced it instead, live, today:

```
improvement/QUACDS-958-standardize-ports   abandoned   "commits, no PR ever opened"   ← PR #358 OPEN
feature/ki-lp-conversion-events            abandoned   "commits, no PR ever opened"   ← PR #405 DRAFT
idea/hubspot-secret-hydration              abandoned   "commits, no PR ever opened"   ← PR #445 DRAFT
```

**Seven rows abandoned, three carrying pull requests.** Traced through `rowQuietKind` → `wipReadings` → `quietKind`, not assumed.

Two corrections it attached, both the author's:

- **Two of the three are DRAFT, one is OPEN.** The plan says *"three open pull requests"* and *"live pull requests under review"*. A draft PR is not under review. The claim holds in the direction that matters — a branch with a draft PR is emphatically not abandoned — but the wording overstates it, and a prior plan got this right.
- **The note's *"rate limits were never reached"* was refuted**: the juror got a `429` from `bb` directly and `EXIT=6` through `plot-host.sh`. Re-checked after the panel: `rc=0`, 705 ms — so the limit was transient, plausibly caused by eight jurors sharing one account. **Both sentences are too absolute.** The honest version: no limit was hit during the original measurement, and the account can be pushed into one under load. The note must say that.

## The premise holds; the plan's own account of the fix does not

Nobody said `reject`. **The defect is real and verified**: `quiet.ts:113` reads `prState === 'none'` as *abandoned*, and `wipReadings`' `pr ? 'open' : 'none'` over a null map makes *the host was never asked* and *the host said no PR* the same word. `prAgeSeconds: null` means no successful fetch has completed in that process, so on the measured repository every branch reads `abandoned`.

What all three refused is the sentence **"the server passes the reading it already holds."** Two jurors traced it independently and both found it false: the fact lives on `CacheEntry.prAt`/`prError`, **seven frames up**, and does not reach `rowsFromPulse` at all. Threading it means appending to `classifyGroup`'s ~19-parameter positional signature — a file whose own comments say four times that inserting a parameter mid-list breaks every spread-tuple caller silently.

**That is the plan's largest under-admission**, and it is the kind that turns a one-slice plan into a multi-site change mid-implementation.

## The finding that reframes the plan

The domain juror found that **`classifyGroup` already takes a `prUnknown` parameter**, whose docstring is almost the plan's own thesis:

> *"an origin that could not be asked propagates as a gap, never as a value a verdict can be computed from."*

It already withholds the slice verdict and already carries a sentence, `PR_UNKNOWN_NOTE`.

**And it is broken in exactly the measured case.** Its only production producer is `held?.state === 'unknown'`, where `held` comes from `prsByHeadMap?.get(...) ?? null` — verified in this session. A null map yields `held === null`, so `prUnknown` is `false` for the whole outage. The loose-branch path passes a hardcoded `false`.

So the reading fires when the host answered badly and stays silent when the host was never asked — **the strictly worse of the two failures**.

This is the CLAUDE.md shape the plan itself invokes, applied one level up: *a mechanism exists and its producer is wrong*. Shipping a second, independently-named expression of the same concept would leave the estate with two unrelated spellings of *the host did not answer* — the drift pair the corpus rule exists to prevent.

## Where the jurors disagree, and it is not averaged

**Two of three say the new state does not belong in `QuietKind` at all.**

- **vocabulary**: spell it `unknown` — matching `HostReach`, `PrSchema.state`, `BriefStateSchema` — and put it on **`QuietBranchReadings.prState`**, not on `QuietKind`. `hostAnswer` already draws this distinction fleet-wide with the right words.
- **domain**: `rowQuietKind` could gain the answer for the ROW while `quietKind` gains a refusal rather than a fifth kind — two decisions the plan merges into one.
- **wire**: *"the fifth kind is the right call and the precedence ahead of `none` is right"* — the only juror endorsing the shape, while still requiring the plumbing be named.

**This is a real design disagreement and the author must settle it, not split the difference.** The question is whether *the host did not answer* is a property of the READING (`prState` gains a word) or of the VERDICT (`QuietKind` gains a kind). Two jurors say the reading; one says the verdict.

## Three things that break silently if this ships as written

Each was verified in this session:

1. **`quietNeedsPerson` answers `true` by fallthrough.** `kind !== 'closed-pr' && kind !== 'merged'` — a fifth kind lands in the true branch, so every branch on a dark host goes to **WAITING ON YOU**. Seven rows demanding a person act on a Plot outage. That may be right; it must be a decision, not a fallthrough.
2. **`everyCase()` stops covering what it promises.** Its docstring says it is *"enumerated rather than sampled so a fourth arm cannot be added without a case covering it."* It loops three dimensions; a fourth reading makes it 24 records. Add the field with a default and leave the loop alone, and the guard the file deliberately built goes quiet.
3. **Ordering.** `unasked` must sit **below `hasMergedPr`** — that reading comes from a different source and can be true while the PR map is dark. The plan's stated reason (*"no `prState` worth consulting"*) invites putting it first, which would re-open the regression `quiet.test.ts:59` locks.

## The shared blind spot

**All three jurors accepted that the board says nothing about the outage.** It does. `prAgeSeconds` is already on the fleet payload and already rendered — *"no PR data yet"*.

So the board **already tells the reader the host was not asked, in the header, while labelling the rows abandoned underneath**. That is the sharpest available statement of the defect, and neither the plan nor any juror led with it. It also raises a question none of them asked: is the row-level word the right repair, or is the defect that the header's knowledge does not reach the rows?

## What the moderation recommends

The plan is **not ready** and the defect is **worth fixing**.

0. **Fix the two factual errors** — DRAFT vs OPEN in the plan, and the rate-limit sentence in the note.
1. **Settle the shape first** — `prState` gains a word, or `QuietKind` gains a kind. Two jurors against one, and it decides everything downstream.
2. **Fix `prUnknown`'s producer** rather than adding a parallel reading, or state in the plan why two readings are right.
3. **Name the plumbing honestly**: `CacheEntry.prAt`/`prError` → `rowsFromPulse` → `classifyGroup`/`rowQuietKind`, appended last, both call sites and the loose-branch path.
4. **Decide `quietNeedsPerson` in the plan text.**
5. **Name `packages/domain/test/quiet.test.ts`** in the slice, including `everyCase()` gaining a dimension.

**Nothing is approved and nothing is dispatched.** The caller decides.

# A post-merge commit is not merged work

> A desk whose merged head it does not hold — a squash merge, or a host answer carrying none — answers empty for unpushed commits, so a commit made *after* the merge is reaped with the checkout. The host already returns the timestamp that separates the two and throws it away.

## Status

- **State:** Approved
- **Approved:** 2026-09-28, jwloka, in-session after panel (round 1)
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1038
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1

## Changelog

- The reaper keeps a desk holding a commit made after its PR merged, including on a squash merge where the merged head exists nowhere in the branch's history.

Board impact: none. The reaper removes checkouts; the board renders what the scan reports.

## Motivation

### The gap, and why it was accepted

`desk_unpushed` (`plot-reap.sh:241`) reads `git rev-list HEAD --not --remotes` and subtracts the merged PR's head commits. The subtraction needs `pr_merged_heads` to return a sha **this desk contains**, and two normal cases leave nothing to subtract:

- a **squash merge**, which rewrites the commits, so the head the host names exists nowhere in the branch's history
- a host answer that **carries no head at all**

In both, `desk_unpushed` answers empty and the desk is reapable. That is deliberate, and the alternative is worse: without the subtraction the bare query reports *every* commit the branch ever had, so a merged desk is held forever for having done the work that merged. That was a live defect — CI red on 2026-09-27, fixed in #1033.

**What the narrowing does not cover:** a commit made on the desk *after* the merge, in exactly that shape. It exists nowhere else and the reaper removes it.

### Measured 2026-09-28

The delivery panel for `one-answer-to-is-a-worker-running` split **2–1** on this. Two jurors built test worktrees holding a commit never pushed, on a branch the host reports merged, and `plot-reap.sh` removed them. All three committed `Evidence: executed`.

The slice's own test asserts the behaviour — *"a merged desk whose merged head this desk does not hold is reaped"* — so this is a known, narrowed guarantee rather than a regression. The release note and the plan's Done-when were narrowed to match; the code was not widened.

### Why ancestry cannot answer

A squash-merged branch is **permanently ahead of main**. That is why `plot-pr-merged.sh` reads `mergedAt` and never ancestry, measured on this estate as ancestry clearing 1 of 29 finished trees against the host's 28. Any fix that re-derives *has this landed* from refs re-introduces the assumption the estate removed.

## Design

### The rule

**A commit whose patch is not already upstream is work the merge did not take, and holds the desk.**

The reading is `git cherry main <desk-branch>`, which compares by **patch-id** — the content of the change — not by sha, ancestry or timestamp. A `-` prefix means *this patch is already upstream*; a `+` means it is not.

### Why not a date comparison, which this plan proposed first

Round 1's juror built fixtures for both date fields and **both fail, in opposite directions**:

| field | fixture | outcome |
|---|---|---|
| `%cI` (committer) | merged work, desk rebased after the merge | **kept forever** — every later rebase re-stamps it, nothing clears it |
| `%aI` (author) | a commit made today from an old patch (`cherry-pick`, `git am`) | **reaped** — the exact work loss this plan exists to prevent |

Measured on this estate: **17 of 200 recent commits have `%aI ≠ %cI`**, so the divergent population is not rare. `max(%aI, %cI)` fixes the false reap and not the false keep.

The false keep is the disqualifying one: it is #1033's forever-hold reached by the fix rather than avoided by it.

### Patch-id passes both fixtures

Measured 2026-09-28, in scratch repositories built from the juror's two cases:

```
CASE A  merged work, desk rebased after a squash merge
        git cherry main work  →  0 commits marked '+'      → REAP   (correct)

CASE B  a commit authored 2026-09-10, made today, on no ref
        git cherry main work  →  1 commit marked '+'       → KEEP   (correct)
```

A rebase does not change a patch-id, so Case A cannot drift into a permanent hold. A cherry-picked old patch that is genuinely absent reports `+`, so Case B cannot be reaped. **No clock is consulted, so neither skew nor a rewritten date can move the answer.**

### It answers the question the dates were a proxy for

*Did this desk's work reach main?* A squash merge rewrites shas and dates and preserves the patch. That is precisely why `plot-pr-merged.sh` reads `mergedAt` rather than ancestry — and patch-id is the same insight applied one level down, to the commits rather than to the branch.

### The host call, and the honest cost

Round 1 claimed the fix "costs no extra host call" on the strength of `mergedAt` being fetched and discarded twice. **That claim is withdrawn**: as specified it would have added a *third* `gh pr list` per desk, because `plot-pr-merged.sh` caches nothing and a new sibling function means a new call.

Patch-id needs **no host call at all** — `git cherry` is local. The reaper's host budget is unchanged.

### One reading site, not two

`desk_unpushed` is called **once**, at `plot-reap.sh:653`. Round 1 named `:506` and `:1040`; both are wrong. `:506` is prose in a comment, and `:1040` is the orphaned-claim-ref loop, which calls `sweep_is_empty_claim` and touches neither function.

The local-branch sweep at `:919` asks `firstBranchRefusal` in `rules/sweepable.ts` — a different rule with no worktree, no `HEAD` to read and no unpushed field. **It is out of scope**, and a test "driving the sweep's counter" would assert something the design does not reach.

### Where the rule lives

`reapProblems` (`rules/reapable.ts:100`) already takes `unpushed?: readonly string[] | 'unknown'`. The fix narrows what the adapter puts in that array, so the rule is untouched — and that means **the whole discriminator would live in bash with no domain test**.

`git cherry` makes that acceptable where a date comparison would not: the shell runs one command and reads its `+`/`-` prefixes, with no comparison logic to get wrong. The slice states this explicitly rather than leaving it implicit, and adds a corpus entry if it finds itself writing any conditional beyond the prefix test.

### What this does NOT do

- **It does not widen the guard back to *any* merged desk.** That is the defect #1033 fixed.
- **It does not change `reapProblems`.** The refusal exists; this changes the reading behind it.
- **It does not touch `plot-release-refs.sh`.** Round 1 argued co-location would keep the two in step; measured, that script has no desk and no unpushed reading, so the argument was empty.
- **It does not use ancestry or a timestamp.**

## Done when

- A desk holding a commit whose patch is **not** upstream is kept, and the refusal names the commit — on a squash merge, where no merged head is in the desk's history.
- **Both round-1 fixtures pass, by name:** merged-work-then-rebased is reaped; an old-dated patch made today is kept. These are the two cases a date comparison cannot satisfy together.
- A desk whose commits are all upstream by patch-id is still reaped — #1033's fix stays fixed, asserted by the existing test.
- Every unreadable reading keeps the desk: `git cherry` failing, an unreadable base, no upstream to compare against.
- **One reading site**, `plot-reap.sh:653`. No change to `sweepable.ts` and no test of the local-branch sweep.
- No new host call, asserted by a test that counts `gh` invocations.

## Slices

### A post-merge commit is not merged work (Branch: bug/a-post-merge-commit-is-not-merged-work)

Read `git cherry` for the desk's branch, keep on every `+` and on every unreadable reading, and test both round-1 fixtures by name.

## Notes

This is the narrowing #1033 made, paid off rather than widened. That plan's delivery panel split 2–1 on exactly this case; the claim was narrowed and the gap filed, which is why the code and the release note agree today.

**The cheap part is that the data is already bought.** Two functions fetch `mergedAt` and discard it — one reduces it to a boolean, the other keeps a sibling field. Nothing here adds a host call.

**Round 1 (2026-09-28): the mechanism was replaced, not amended.** The evidence juror committed `amend` having executed, reproduced the defect with a real `plot-reap.sh` run, and then killed the proposed fix with two fixtures — `%cI` keeps a merged desk forever, `%aI` reaps a live commit. It also found three factual errors: both cited line numbers wrong (`:506` is a comment, `:1040` is a different loop), the zero-cost claim inverted (a new sibling function is a *third* `gh` call, since nothing caches), and a co-location argument naming a consumer that does not consume.

**The measurement design was the deeper error.** Round 1 asked the slice to choose a date field *"against a fixture that rebases"* — an experiment that can only ever exonerate `%aI`, because a rebase is exactly what `%cI` survives badly. The juror built the pair and the answer was *neither*.

`git cherry` was found by asking what the dates were a proxy for. It passes both fixtures and needs no host call. Verdict and full reading: `.plot/panels/2026-09-28-a-post-merge-commit-is-not-merged-work/evidence.md`.

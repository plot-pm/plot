# A post-merge commit is not merged work

> A desk whose merged head it does not hold — a squash merge, or a host answer carrying none — answers empty for unpushed commits, so a commit made *after* the merge is reaped with the checkout. The host already returns the timestamp that separates the two and throws it away.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1038
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

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

**A commit authored after its PR merged is not work the merge took, and holds the desk.**

The reading is a comparison, not an ancestry question: the desk's commit dates against the PR's `mergedAt`.

### The timestamp is already on the wire

`pr_merged_heads` (`plot-pr-merged.sh:196`) fetches `--json mergedAt,headRefOid` and emits **only** `headRefOid` (`:205`). `_plot_merged_lookup` fetches `--json mergedAt` and reduces it to `found`/`none` (`:126-128`).

**So the fix costs no extra host call.** The value is fetched, tested, and discarded twice. The slice exposes it — a `pr_merged_at` beside `pr_merged_heads`, in the same sourced helper, so the reaper and `plot-release-refs.sh` cannot disagree about it.

### The reading is soft, and the plan says so

A commit date is not proof. A rebase rewrites author dates, and clocks skew between machines. **This is evidence, not a gate**, and it must fail toward KEEPING the desk:

- no `mergedAt` → keep, as `unknown` does today
- an unparseable date → keep
- a commit whose date cannot be read → keep

That asymmetry is the whole safety argument: the cost of keeping a reapable desk is a stale checkout, and the cost of reaping a held one is work that exists nowhere else.

### What the slice must measure before building

**Whether author date or commit date is the right field.** `git log --format=%aI` (author) survives a rebase; `%cI` (committer) is rewritten by one. The post-merge case the panel measured was a plain commit on a desk, where both agree. The slice states which it reads and why, against a fixture that rebases.

### What this does NOT do

- **It does not widen the guard back to *any* merged desk.** That is the defect #1033 fixed, and it holds every squash-merged desk on the estate forever.
- **It does not change `reapProblems`.** `unpushed-commits` is already a refusal; this changes what the adapter reads.
- **It does not touch `plot-release-refs.sh`'s guards.** Deleting a ref is a separate licence, deliberately narrower.
- **It does not use ancestry.** See above.

## Done when

- A desk holding a commit authored after its PR's `mergedAt` is **kept**, and the refusal names the commit — on a squash merge, where no merged head is in the desk's history.
- A desk whose commits all predate the merge is still **reaped** — the case #1033 fixed stays fixed, asserted by the existing test rather than a new one.
- Every unreadable reading keeps the desk: no `mergedAt`, an unparseable date, an unreadable commit date.
- `pr_merged_at` lives in `plot-pr-merged.sh` beside `pr_merged_heads`, sourced not run, so there is one answer to *when did this land*.
- Both reading sites are covered — `plot-reap.sh:506` and `:1040` — asserted by a test driving the sweep's counter.
- The slice records whether it reads author or committer date, with the fixture that decided it.

## Slices

### A post-merge commit is not merged work (Branch: bug/a-post-merge-commit-is-not-merged-work)

Expose `mergedAt`, compare it to the desk's commit dates, keep on every unreadable reading, and test the squash-merge shape both ways.

## Notes

This is the narrowing #1033 made, paid off rather than widened. That plan's delivery panel split 2–1 on exactly this case; the claim was narrowed and the gap filed, which is why the code and the release note agree today.

**The cheap part is that the data is already bought.** Two functions fetch `mergedAt` and discard it — one reduces it to a boolean, the other keeps a sibling field. Nothing here adds a host call.

# The fleet knows the order and not the overlap

> Waves say which branch may start. They say nothing about which file it will
> open — so a correct "eligible" can still name a branch that two agents will
> fight over.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:**
- **Started:**
- **Delivered:**

## Problem

Observed 2026-08-16, twice within an hour, and both times a human had to supply
the missing check by hand.

**The pulse's wave ordering is right and is not the whole answer.** The moment
`feature/fleet-row-phase` merged, `plot-fleet-scan.sh --next` offered
`feature/agent-view-phase-ui` — correctly: wave 1 was done, so wave 2 was
eligible, re-derived from refs with no flag to set and nothing to forget. But
`bug/board-shows-staleness`, from a *different plan*, had `AgentList.tsx` open
in an agent's worktree, and the eligible branch edits that same file. Nothing
in the model represents that.

Waves are a **within-plan** ordering. Collisions are **across plans**, and no
plan can declare them alone.

**And the built artifact collides between any two board branches, always.**
Measured: `skills/plot/scripts/board/board-server.mjs` is **796 KB across 177
lines** — roughly 4,500 characters per line. Git merges line by line, so every
change to the board, whatever source file it came from, lands in the same
handful of enormous lines. Two branches that touch entirely disjoint sources
still conflict there, and the conflict cannot be meaningfully resolved by
reading it.

That has been the binding constraint on parallel board work three times today.
It is why `bug/board-binds-port-zero` is held back although its sources are
free, and why every dispatch this evening required a human to read worktrees
first.

**Demonstrated while this plan was being written.** PR #141
(`bug/board-shows-staleness`) opened as `mergeable=CONFLICTING`, and
`merge-tree` names the whole of it:

```
Auto-merging skills/plot/scripts/board/board-server.mjs
CONFLICT (content): Merge conflict in skills/plot/scripts/board/board-server.mjs
```

One file, and it is the generated one. Not a single source conflict — the
branch edits `App.tsx` and `AgentList.tsx`, main had moved elsewhere, and those
merged cleanly. A human now has to resolve a 796 KB minified diff whose correct
resolution is *throw both away and rebuild*.

### What already exists, and where it runs

Neither half needs a new mechanism; both need an existing one at a different
moment.

`plot-merge-queue.sh` already predicts conflicts with `git merge-tree
--write-tree` — in memory, no checkout, non-zero exit means conflict — and
already guards the git-2.38 requirement, because the older `merge-tree`
silently answers a different question and would report everything as clean.
Verified on the live branch while writing this plan:

```
git merge-tree --write-tree origin/main <bug/board-shows-staleness HEAD>  → exit 1
```

The prediction was available. It was simply never asked before dispatch — only
before merge, which is after the cost has been paid.

## Design

### 1. The artifact stops being worth fighting over

**A conflict in a reproducible file is not information.** `board-server.mjs` is
generated output: any version of it is exactly as good as any other, because
`pnpm build:board` reproduces the correct one from sources that merged cleanly.
So the merge stops trying to reconcile it, and a rebuild settles it.

This is the smallest change that removes the constraint, and it deliberately
does **not** take the file out of git. It is checked in for reasons that still
hold: `pnpm board` starts it with no build step, and the plugin ships it. CI
does not need it as an input — the workflow runs `pnpm run build:board` itself
and then diffs, so the committed file is an *expectation*, not a dependency.
Removing it would mean changing how the board starts, how the plugin ships, and
what the CI gate compares against — a large change to fix a merge problem.

**The CI gate stays exactly as it is.** It is the thing that keeps this honest:
if a branch resolves a conflict by keeping a stale artifact and forgets to
rebuild, the no-diff check fails. The strategy removes the *conflict*; the gate
still enforces *correctness*.

### 2. Dispatch asks before it fans out

`plot-dispatch` runs the prediction that `plot-merge-queue` already implements,
against the work in flight, before creating a worktree.

**Against local refs AND worktrees, not the remote.** This is where the
refs-are-truth principle bends for a good reason, and the reason is measured:
the collision that blocked a dispatch this evening lived in an **unpushed
commit**. `bug/board-shows-staleness` had committed, its worktree was clean,
its remote ref held only the claim — invisible to any remote-based check.
Uncommitted work is invisible to refs entirely.

Both sources are readable here and only here:

- `refs/heads/*` — unpushed commits. Worktrees share one ref database, measured
  in [`fleet-sees-unpushed-commits`](2026-08-16-fleet-sees-unpushed-commits.md):
  `git rev-parse` answers from the main repo for a branch checked out elsewhere.
- `git worktree list` + `git status` — uncommitted changes, which no ref holds.

That is sound rather than a violation, because **dispatch is inherently local**.
It creates worktrees on this machine; it is already the one Plot command whose
job is machine-specific. A check that ignored what this machine knows would be
blind precisely where it acts.

### 3. A predicted collision skips the branch and says so

The candidate is **not dispatched**, the summary names it and what it collides
with, and every other candidate starts normally.

Skipping rather than warning-and-starting: an agent that is already running is
hard to recall, and a warning in a dispatch log competes with nothing for the
reader's attention until two agents have already rewritten the same file. The
existing summary line already carries `skipped=N`, so a skipped branch is
counted rather than silently dropped — the rule this repo applies to every
bounded result.

**It reports, it does not decide policy.** A human who wants it anyway can
dispatch that branch explicitly; the check exists to stop the *accidental*
case, which is the one that happened twice today.

### 4. The row says blocked, because it is

A held-back branch currently reads **`eligible — nobody has taken it`**, and
that sentence makes two claims of which only one is true. *Nobody has taken it*
is correct: no claim ref exists. *Eligible* is not — a dispatch would be
refused, or would collide.

The failure is not cosmetic, because the row is **indistinguishable from a
genuinely free one**. On the board tonight, `feature/agent-view-phase-ui`
(blocked by an agent editing `AgentList.tsx`) and `feature/plot-sprint-support`
(free since February, waiting for anyone) render the identical note. One is
waiting on a machine; the other is waiting on a person. The reader cannot tell,
and the tab exists precisely to tell them.

It is also the same mismatch this repo already rejected elsewhere: the Start
button appears only on eligible rows, because offering an action the tool will
decline teaches people to distrust the offer. A row that says *eligible* is
that offer in text.

So the vocabulary gains the state it is missing. `blocked by an earlier wave`
already exists for the **within-plan** case; the **across-plan** case has no
counterpart, which is why an accurate scan produces an inaccurate row. The note
names what holds it — the branch, not merely the fact — because *blocked* alone
invites the next question and the scan already has the answer.

**Derived, never stored.** The pulse is stateless by design and stays so: the
collision is re-computed from refs and worktrees on every scan, exactly like
wave state. A branch stops reading blocked the moment the work it collided with
lands, with nothing to clear.

## Branches

### Merge

- `infra/board-artifact-merge` — a merge strategy for
  `skills/plot/scripts/board/board-server.mjs` so conflicts in the generated
  bundle are settled by rebuilding rather than by reading; CI's no-diff gate
  unchanged

### Prediction

- `feature/dispatch-predicts-collisions` — `plot-dispatch` runs
  `merge-tree --write-tree` against local refs and worktrees before fanning
  out; a predicted collision skips the branch, names it and its counterpart in
  the summary, and counts toward `skipped=`
- `feature/fleet-row-says-blocked` — the pulse reports a cross-plan collision
  as its own state, so a held-back branch stops reading `eligible — nobody has
  taken it`; derived per scan, never stored

Two waves, and the order is deliberate: the artifact strategy is what makes any
board branch mergeable at all, and the prediction is more useful once the
artifact stops producing a collision on every single pair.

## Done when

- **Two board branches that touch disjoint sources merge without an artifact
  conflict.** Assert against real branches, not a fixture: the 177-line shape
  is what causes this and a small synthetic file would not reproduce it.
- **A merged branch still fails CI if the artifact is stale.** The gate must
  survive the strategy — assert that resolving by rebuild is required, not
  optional. Without this the change trades a conflict for a silent
  regression.
- **A candidate colliding with an unpushed commit is skipped.** The exact case
  from 2026-08-16: committed, clean worktree, remote ref holds only the claim.
  A remote-only check passes this test while missing the bug.
- **A candidate colliding with UNCOMMITTED work is skipped.** No ref holds it,
  so this fails against any implementation that reads refs alone.
- **A skipped branch is named, with what it collides with**, and counted in
  `skipped=`. Assert the count: a silent skip reads as "nothing was eligible".
- **A non-colliding candidate still dispatches.** The regression that matters —
  a check that skips everything is indistinguishable from a broken fleet.
- **A blocked branch does not read `eligible`.** Assert the note differs from a
  genuinely free branch's: tonight `feature/agent-view-phase-ui` and
  `feature/plot-sprint-support` rendered identically while one waited on a
  machine and the other on a person.
- **The blocked note names what holds it.** Assert the counterpart branch
  appears — *blocked* alone invites a question the scan can already answer.
- **A branch stops reading blocked once the collision lands**, with nothing
  cleared by hand. Assert it against a second scan: a stored flag passes the
  first assertion and fails this one.
- **git older than 2.38 refuses rather than reporting clean.** `plot-merge-queue`
  already guards this because the old `merge-tree` answers a different question;
  the guard must travel with the prediction, not be reimplemented beside it.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`,
  `pnpm run validate` all pass.
- A changeset is present.
- macOS bash 3.2: no `declare -A`.

## Notes

Both halves were found by dispatching, not by reading — the pattern this
session repeated all evening. The wave ordering looked complete until an
eligible branch pointed at a file an agent already had open.

Related and deliberately separate:
[`fleet-sees-unpushed-commits`](2026-08-16-fleet-sees-unpushed-commits.md)
makes unpushed work *visible in the board*; this plan makes it *consulted by
dispatch*. Same blindness, two different consumers, and the measurement that
unpushed commits are readable from the main repo is shared between them.

Recorded as open points in
[`plot-board`](../stories/plot-board/STORY-plot-board.md) on 2026-08-16.

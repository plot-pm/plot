## Implementation brief — fleet-sees-unpushed-commits

- **Plan (canonical):** `docs/plans/2026-08-16-fleet-sees-unpushed-commits.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #139 merged (one interrogation round)
- **Branch:** `bug/fleet-sees-unpushed-commits` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

One field, one classifier rule, one row string, on top of a mechanism that
already shipped in #137.

`local_dirty` reports *someone is editing*. It cannot see a worker who commits
and pauses before pushing — the worktree is clean, the flag is false, and the
board reads **"claimed, no commits yet"** for a branch holding finished work.
That is not hypothetical: it happened on `bug/fleet-sees-local-work`, the very
branch that fixed the other half, with 3 commits ahead and 0 dirty files.

`local_ahead` closes it. Read the plan in full.

### The one thing the plan corrected, and it changes the implementation

**This is a REF question, not a worktree question.** The first draft bound it to
the worktree list for symmetry with `local_dirty`. That was wrong, and it was
measured: worktrees share one ref database, so from the main repo

```sh
git rev-parse refs/heads/bug/board-shows-staleness   # → answers for ANOTHER worktree's branch
```

So the comparison needs no `git -C` and no worktree at all:

```sh
out=$(git rev-list --count "refs/remotes/origin/$br..refs/heads/$br" 2>/dev/null); rc=$?
```

Measured at **5.2 ms** per call (20 iterations from the main repo).

Do not route this through `worktree_rows()`. A local branch with no worktree —
checked out once and left, or fetched from a colleague — still holds commits
nobody can see, and the worktree-shaped version skips exactly those. Dirtiness
belongs to a working directory; aheadness belongs to the refs.

### Four rules carried over unchanged from `fleet-sees-local-work`

**Absent is not false.** A branch with no local ref answers from the remote
exactly as today.

**One-directional.** It may LIFT a branch out of quiet and may never downgrade
a group. A branch with an open PR still answers about its PR.

**Read the exit code, not the emptiness.** A missing upstream exits **128 with
empty output** — bit-identical to the deleted-worktree signature the shipped
code already handles. Empty output must not read as "zero ahead", for the same
reason empty `git status` output must not read as "clean".

**No cap.** ~104 ms for twenty branches on a scan that runs 500–1050 ms, and
the count follows the plans rather than the checkout.

### Two more decisions the plan settles

**Iterate the branches the plans name, as today.** The scan is a *fleet* view,
not a branch listing. `local_ahead` answers *this planned work is invisible*,
not *show me every local branch*.

**Ahead only — divergence is not this plan's question.** Being *behind* is not
an invisible state; it is in the remote for anyone to read.

**Dirty AND ahead says both, unpushed first** — e.g. `2 commits not pushed,
uncommitted changes`. Suppressing a true fact because another outranks it is
the displacement `deferred` already causes to the note text. The pair changes
the advice: *push this* versus *push this, and someone is still working*.

### Done when

The plan's `## Done when` list is the specification. Three assertions there
exist because a naive test passes without them:

- **A local branch with NO worktree is still seen** — the assertion that fails
  if someone routes this through the worktree list "for consistency".
- **A missing upstream is DETECTED, not read as zero** — assert the failure was
  observed, not that the outcome happened to be right.
- **A branch BEHIND the remote reports zero ahead** — `A..B` and `B..A` are
  easy to swap, and the swapped version reports everyone else's pushes as local
  work.

Plus: `pnpm run test:board`, `pnpm run test:reconcile`, `pnpm run typecheck`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own worktree**
and the artifact committed (CI gates on no-diff); a changeset is present; bash
3.2 only (macOS), so no `declare -A`.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Push your first real commit as soon
as it exists** — which is, precisely, the failure this plan makes visible.

### Scope guard

`skills/plot/scripts/plot-fleet-scan.sh`, `packages/board/src/server/fleet.ts`
and their tests.

One other branch is in flight (`bug/board-shows-staleness`), on
`App.tsx`/`AgentList.tsx` — verified at dispatch to have no overlap with yours.
The only shared surface is the built artifact
`skills/plot/scripts/board/board-server.mjs`, which every board branch rebuilds.
Rebuild it in your own worktree and expect to rebase if that branch lands first.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

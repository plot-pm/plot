## Implementation brief — a-finished-plan-delivers-and-clears-up (wave: Cleared)

- **Plan (canonical):** `docs/plans/2026-08-27-a-finished-plan-delivers-and-clears-up.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `feature/a-delivered-plan-releases-its-refs` (base: `main`)
- **Ends as:** one PR to `main`

**Wave 4 of 4** — the last. `Landed` (#479), `Extracted` (#483) and `Delivered`
(#493) have all merged, so `plot-deliver.sh` exists, the board calls it, and the
reap runs after delivery. This wave deletes the refs.

### What to build

Delivery deletes the **remote refs** of its merged branches, after the reap.

### The decisions the plan settles — do not re-derive them

**AFTER the reap, not before.** The ordering is the same argument wave 3 made
about delivery and reaping: both orders end with no ref and no worktree, so an
end-state test passes either way. Assert the ORDER.

**Read `mergedAt`, never `state`.** A merged PR reports `state: CLOSED`, and
squash-merge leaves a branch permanently "ahead of main" so ancestry cannot
decide either. `plot-reap.sh` already reads it correctly — the plan says the gate
is "a merged PR read as `plot-reap.sh` reads it", so call the same derivation
rather than writing a second one.

**An unlanded branch keeps its ref, ALWAYS** (item 12). This is the
`/plot-implement` rule: *never delete a remote ref another session may be
reading*. A branch given up is annotated `deferred:`/`moved:` and its ref is left
in place. Deleting one is the failure this wave must not have, and it is
unrecoverable in a way a wrong worktree removal is not.

**This was exercised by hand on 2026-08-28 and the edge cases are known.** Ten
merged refs were deleted; two were deliberately kept, and both are cases this
code will meet:

- **`changeset-release/main`** — merged, but Changesets recreates and reuses it.
  Deleting it disturbs the live release PR.
- **A branch whose worktree still holds it** — removing the ref pulls it out
  from under a checkout.

Guard both. The second is checkable with `git worktree list`; the first argues
for skipping any branch that has an OPEN PR even where an older one merged.

### Done when

The plan's `## Done when` items 11 and 12:

- **A delivered plan's merged branches lose their remote refs.**
- **An unlanded branch keeps its ref, always.** The assertion a naive
  implementation passes without — a sweep that deletes every ref of a delivered
  plan satisfies item 11 and destroys unlanded work. Assert with a plan holding
  one merged and one unmerged branch.

Plus the two guards above, and: `pnpm test`, `pnpm run test:reconcile` green; a
changeset with a `bumps:` block naming `plot`; Node 24 (`nvm use`,
`corepack pnpm`); `trash` not `rm`.

**Do not run `pnpm run test:board`** (operator rule).

### Bookkeeping

Annotate this branch inside its **wave heading** on main:
`(Branch: x, PR: #N)` INSIDE the heading — Waves dialect.

### Scope guard

This branch owns the ref deletion, wherever delivery already reaps — do not
re-open `plot-deliver.sh`'s transition (that was `Extracted`) or `plot-reap.sh`'s
merge test (that was `Landed`). Rebase onto current main before you start.

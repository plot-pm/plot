## Implementation brief — adoption-proposes-a-worktree-root (slice: Adoption says where desks live)

- **Plan (canonical):** `docs/plans/2026-09-06-a-desk-is-adopted-and-swept.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `feature/adoption-proposes-a-worktree-root` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 1 of two. Two rounds.

## The gap

**Adoption never mentions where desks go.** Verified 2026-09-06: `skills/plot-init/SKILL.md` names `Worktree root` **zero times** and `.gitignore` **zero times**.

The key defaults to `.worktrees`, which is the intended layout — and an adopting repository gets it **without being told, without the ignore rule, and without a chance to choose otherwise.**

**A dispatched agent's desk is then untracked work in the repository root.** The operator's next `git add -A` stages a whole checkout.

## THIS IS A NEW WRITE SURFACE, AND THE ROUND MADE THAT EXPLICIT

`plot-init` writes config, a plan skeleton and templates. **It has never touched `.gitignore`.** So this is not one more line in a file adoption owns.

**It still writes on confirmation, like everything else adoption creates.** A directory and a plan skeleton are larger commitments than one ignore line, and both are written today. **Printing the line for a human to paste is how a repository ends up with desks as untracked files** — which is the defect, not the fix.

## The wording to copy

This repo's own `.gitignore:20-23` carries the line and a comment explaining it:

```
# The dispatch worktrees, gathered here by the `Worktree root` key rather than
# …
.worktrees/
```

**And the desk's own exclusion is separate and stays where it is.** `.gitignore:75-79` explains why: a rule in branch content is invisible to a worktree cut from an older branch, so `.git/info/exclude` is what protects a **desk**. That one is `plot-dispatch.sh`'s; this slice writes the repo's line only.

## It is a proposal, like every other field

`plot-init`'s guiding rule is *"propose, don't interrogate"* (`SKILL.md:23`), and `plot-detect-repo.sh`'s every field is *"a proposal a human confirms."*

**A repository that already has a worktree convention keeps it**, and the ignore line follows whatever it chose rather than the default.

## Testing

`pnpm test` validates that every skill parses.

**Two cases:** `/plot-init` in a fresh repository proposes the key and writes the line on confirmation; a repository that declines gets neither, and nothing else about adoption changes.

## Done when

- `/plot-init` proposes `Worktree root` with its default
- it writes the `.gitignore` line on confirmation and nothing on decline
- a repository with its own convention keeps it
- the desk's `.git/info/exclude` rule is untouched
- the gates above pass

## Do not

- **Do not write `.gitignore` without confirmation.** It is read by every tool the team uses, and adoption proposes.
- **Do not move the desk's own exclusion.** `.git/info/exclude` is per-clone for a stated reason and belongs to dispatch.
- **Do not force the layout.** A repo that wants desks elsewhere says so.
- **Do not add the reaper's `prunable` reading here.** That is slice 2.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.

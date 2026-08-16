## Implementation brief — fleet-sees-local-work

- **Plan (canonical):** `docs/plans/2026-08-16-fleet-sees-local-work.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #121 merged (two rounds of interrogation)
- **Branch:** `bug/fleet-sees-local-work` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

The fleet reads refs, and an agent editing files writes none — so a branch
someone is actively working reads as abandoned, on the one machine that could
have known better.

`plot-fleet-scan.sh` reports one new per-branch field, `local_dirty`, and
`classify()` uses it **only to lift a branch out of quiet**. Read the plan in
full: it is short, and every decision in it was argued or measured, several
against alternatives that were tried and rejected.

### Five things the plan settles that are easy to get wrong

**Any state that would otherwise read quiet, not only `claimed`.** The
motivation describes a resumed claim, but all six quiet rows on this board
today are `wip` with 22-day-old commits. A dirty worktree means the same thing
whatever put the branch there.

**Absent is not false.** A machine with no worktree for a branch — every
detached worker, every teammate's laptop — answers from refs exactly as today.
The signal is strictly one-directional: it may *add* an answer where this
machine knows more, never downgrade one. That is the whole reason it can be
added without weakening refs-as-truth.

**Dirty, not present.** A clean worktree is equally consistent with finished and
never-started, so it lifts nothing — and shows nothing in the row.

**Skip `prunable`, read the exit code.** A deleted worktree directory leaves its
entry behind; `git status` then exits **128 with empty output**. A check on
emptiness reads "clean" and is right *by accident*. `git worktree list
--porcelain` already marks those entries — use that, and treat a non-zero exit
as a failure to observe rather than as evidence of cleanliness.

**No cap.** Measured: 6.6 ms per worktree, so twenty cost ≈133 ms against a scan
that already runs 500–1050 ms. A cap would be stock against a problem the
numbers rule out, and caps drop results silently unless they also report
saturation.

### The worktree path goes in the plan modal

`git worktree list --porcelain` returns the path alongside the branch, and the
scan already parses that output and drops it. Keep it: the **plan modal** shows
the local worktree path, copyable, labelled as local. Shown for *clean*
worktrees too — that is the one place the clean/dirty distinction inverts, and
consistently so: dirtiness is evidence of **work**, presence is evidence of
**location**, and the modal asks about location.

### Done when

The plan's `## Done when` list is the specification — work through it literally.
Two assertions there deserve naming because a naive test passes without them:

- **A missing worktree does not lift, and not because it looks clean.** Assert
  the failure was *detected*, not merely that the outcome happened to be right.
- **A branch with no worktree on this machine answers exactly as today.**
  Without it, a regression that downgrades remote branches passes unnoticed.

Plus: `pnpm run test:board`, `pnpm run test:reconcile`, `pnpm run typecheck`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own worktree**
and the artifact committed (CI gates on no-diff, and a rebuild elsewhere leaves
yours stale — that has cost a diagnosis three times in this repo today); a
changeset is present; bash 3.2 only (macOS), so no `declare -A`.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`.

### Scope guard

`skills/plot/scripts/plot-fleet-scan.sh`, `packages/board/**` and their tests.

**Not concurrent with `agent-view-phase` (#131)**, which adds a phase field to
the same rows and the same two files. It is still Draft; if it is approved while
you work, say so rather than merging around it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

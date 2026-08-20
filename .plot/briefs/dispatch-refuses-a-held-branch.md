# Brief — bug/dispatch-refuses-a-held-branch

Finding 4 of `docs/plans/2026-08-20-a-held-branch-says-who-holds-it.md`.
**This is the gate, and it is the point of the plan.**

## The measurement

`plot-dispatch.sh --dry-run` reported `claimed=0` across a fleet with four live
agents, and offered `feature/the-row-carries-its-verdict` and
`feature/reconcile-calls-the-index-advisory` — both already implemented, tested
and green — as dispatchable. Acting on that output puts a second agent on
finished work.

## Why a rule cannot fix it

"Always dispatch through `plot-dispatch.sh` so the claim ref exists" is a rule,
and it was violated four times in one evening by an operator who had read it
that same evening. The check *"did I claim this?"* is answerable without doing
it. See CLAUDE.md § Gates Over Rules.

## The evidence is already collected

`plot-dispatch.sh` **already enumerates worktrees**: its "in flight: `<branch>`
holds `<files>`" report reads local refs and worktrees to predict collisions,
and correctly listed 40 branches. It can see what a branch *touches* and not
that someone is *holding* it, because the two facts come from different sources
in the same script.

## Scope

Refuse a branch whose worktree exists **with an unmerged tip**, naming the
worktree path. Count it as `skipped`, and say so in `--dry-run` too — a dry run
that offers what a real run would refuse is worse than no dry run.

Three things this must NOT do:

- **Not claim on the operator's behalf.** Writing a claim ref for a worktree the
  script did not create puts a record in git nobody asked for, and a stale ref
  is worse than an absent one.
- **Not refuse a leftover worktree on a merged branch.** There are several on
  this machine. Merged tip → still dispatchable.
- **Not let `--allow-local` override it.** That flag is the named escape for a
  repo with no remote; it says nothing about whether a human is mid-edit.

## Tests

- a branch with a worktree and an unmerged tip is refused, counted `skipped`,
  and the message names the worktree path
- `--dry-run` refuses it identically
- a worktree on a merged branch is still dispatched
- `--allow-local` does not override the refusal
- a branch with no worktree is unaffected

Add to `test/reconcile/dispatch.test.mjs`, following its existing sandbox style.

## Definition of Done

- `pnpm test`, `pnpm run test:reconcile` green
- changeset with a `bumps:` block — `plot: minor`
- `trash`, not `rm`

## Hazards

`dispatch.test.mjs` needs ~317 s alone and the runner's window is ~399 s, so
under contention it is starved rather than broken. Re-run it alone before
believing a failure. Wait on your own PID. Do not touch sibling worktrees.

## Implementation brief — the-worktrees-live-in-one-place (wave Moved)

- **Plan (canonical):** `docs/plans/2026-08-23-the-worktrees-live-in-one-place.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session (2 rounds)
- **Branch:** `infra/idle-worktrees-can-be-migrated` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 2 of 2. `Rooted` merged as **#445** — `Worktree root:` is read
(`plot-dispatch.sh:117`), and the prefix follows the root (`:121`). This wave
moves what already exists.

### What to build

A `--migrate` mode that moves worktrees into the configured root using
`git worktree move`, and **reports what it skipped and why**.

### THE REFUSALS ARE THE FEATURE

`git worktree move` on a checkout an agent is writing to breaks it mid-run.
Measured on this machine today: **six worker-loop processes live at once**, and
the cap is 7.

So `--migrate` moves a worktree only when it has **no live worker and no
unlanded work**, and names every one it skipped with the reason. Model the
refusals on `plot-reap.sh`, which already refuses on five MEASUREMENTS rather
than judgements — a live pid, uncommitted changes, a `PLOT-BLOCKED*` marker, a
tree on the default branch, no merged PR. Reuse `plot-worker-state.sh` for the
liveness answer; it is the ONE answer to *is a worker running in this worktree*
and is sourced by both dispatch and the fleet scan.

**`--dry-run` by default**, like `plot-reap.sh`. `--yes` moves.

### A mixed estate is an ordinary state, not a transition to complete

The plan is explicit: existing worktrees stay where they are and keep working;
every read asks git, so a mixed estate is not a special case. **`--migrate` must
never be required.** A repo that adopts `Worktree root:` and never migrates is
correctly configured.

That is why this is opt-in and idempotent rather than automatic, and why a
worktree it refuses is not an error.

### Why this wave exists at all — the argument round 2 settled

Convergence by attrition was considered: let `plot-reap.sh` remove each finished
worktree as its work lands, and the estate empties itself. It works for the ones
that finish.

It fails for the two on this machine whose **PRs closed unmerged while their work
reached main by other routes** — `plot-reap.sh` reads `mergedAt` and refuses them
permanently. Attrition would leave exactly the checkouts a person most wants
moved. **Do not re-propose attrition.**

### Done when

The plan's `## Done when` list is the specification. This wave's items:

- **`--migrate` moves an idle worktree** into the configured root.
- **It REFUSES one with a live worker or unlanded work, naming what it skipped.**
  Both halves — a mode that moves everything passes the first and breaks a
  running agent.
- **A repo declaring no `Worktree root:` has nothing to migrate**, and the mode
  says so rather than inventing a destination.
- **Every "where is this branch" read still asks `git worktree list`.** `Rooted`
  established this; moving a worktree must not tempt anything into composing a
  path to find it afterwards.

Plus `pnpm test` and `pnpm run test:e2e`. Node 24 (`nvm use`).

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Moved (Branch: infra/idle-worktrees-can-be-migrated, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists, and run
every test in the FOREGROUND — a `-p` run receives no notification.

### Scope guard

This branch owns the `--migrate` mode and its tests.

**Do not change `Rooted`'s work** — the config key, the root resolution and the
prefix rule are merged and settled.
**Do not migrate anything as a side effect of this branch.** The mode is what
ships; running it on this estate is a separate, deliberate act by a person.

Add a changeset naming `'plot'` with a `bumps:` block. CI validates the package
name and that each bumped skill is a real directory.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

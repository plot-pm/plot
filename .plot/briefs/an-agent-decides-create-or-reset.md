## Implementation brief — an-agent-decides-create-or-reset (wave Holding one desk)

- **Plan (canonical):** `docs/plans/2026-09-02-an-agent-holds-one-desk.md` on `main`
- **Approved:** 2026-09-02, Jan Wloka, in-session
- **Branch:** `feature/an-agent-decides-create-or-reset` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Wave 2 of five. **This is the slice that stops 2 agents holding 11 worktrees.**

### What this branch owns

**The hop stops creating a desk.** `plot-worker-loop.sh:719` computes `wt_root` and `:721` builds `new_wt` from the branch name; `:723` runs `git worktree add -b "$next_branch" "$new_wt" "origin/$main_branch"`, falling back at `:724` to attaching an existing branch. The loop then `cd`s into the new desk at `:744` and leaves the old one on disk — the only `git worktree remove` in that block is `:731`, the race-loss path. **The agent takes the desk it already holds and works the next slice in it.**

**The agent decides, because it is the only party that can see its own tree.** The registry sees identities; the machine sees processes; only the agent at the desk sees uncommitted changes, a `PLOT-BLOCKED` marker, or a checkout still on a merged branch. The decision is two readings:

- clean tree, branch merged → **reset**: the desk stays
- anything unlanded → **create** a new desk and leave this one for the sweep

**The reset checks out the base before the branch, and that order is the deliverable.** `.gitignore` is per-checkout: a worktree sees an ignore entry only once its base branch carries it. That stranded 19 desks on 2026-09-02, every one held by a single untracked artifact the ignore list had gained after those desks were cut. A desk switching straight to a branch that already exists from an earlier attempt inherits *that* branch's rules. **Check out `origin/<main>` first, then the slice's branch.** One extra checkout buys a desk whose state is independent of whatever it held before.

**It does not `reset --hard` and it does not `clean -fdx`.** Those destroy whatever the create-or-reset guard failed to notice, and the guard being wrong is exactly the case where destruction cannot be undone. A guard that misjudges must leave a desk the sweep reports, not deleted work. A leftover desk costs a sweep; lost work costs the work.

**The guard is a measurement, never a judgement** — the same shape as every refusal `plot-reap.sh` makes. `plot-worker-state.sh:46` reads a `PLOT-BLOCKED` marker from the tree and `:47` reads uncommitted or unpushed work; both readings are the ones this guard needs, and reusing them keeps one implementation rather than two that can drift.

**Taking over the next slice IS the freeing.** The agent resets the desk it holds and the old checkout ceases to exist, so nothing is abandoned and `finished → reapable → gone` needs no separate step on the normal path.

**A rejected claim push stops being routine.** `plot-worker-loop.sh:729` comments *"another worker won the race"* and `:730`–`:732` remove the worktree and `continue` silently. Under this model the registry is the assignment lock, so a rejection is a bug reporting itself. **Log it loudly** — the estate is protected at the moment the invariant is already broken. The retry behaviour may stay; the silence may not.

**The manifest must still describe where the agent is.** `update_manifest_on_hop` at `plot-worker-loop.sh:183` rewrites `branch` and `worktree` and bumps `wavesCount`. When the desk persists, `worktree` no longer changes on a hop and `branch` does. Keep the call and keep `wavesCount` counting slices — `packages/board/src/server/registry.ts:114` documents that `session` stays fixed across a hop while `branch` and `worktree` are rewritten, and the board reads that.

**`git worktree add` becomes the exception.** A full checkout is paid once per agent rather than once per slice.

### What it does NOT own

**It does not derive or render `free`.** `feature/an-agent-says-when-it-is-free` owns clearing `branch` at the finish and the `free` property. Base on a `main` that contains it, or the two will collide in `update_manifest_on_hop`.

**It does not remove `--offline --next`.** `plot-worker-loop.sh:716` stays. The loop still shops for its own branch until the registry assigns, which is `feature/the-registry-queues-a-brief`.

**It does not touch `plot-dispatch.sh:2503`.** Dispatch still creates the first desk; the registry hand-over is a later wave.

**It does not reap, sweep, or delete a branch.** `feature/the-sweep-names-every-leftover` owns every leftover, the desks this estate already carries included.

**It does not amend a spec.** `docs/the-desk-belongs-to-the-agent` owns `DESIGN-worktree.md:60`.

### Done when

- [ ] `plot-worker-loop.sh` no longer runs `git worktree add` on the hop when the desk can be reset.
- [ ] The reset checks out `origin/<main>` and then the slice's branch, in that order, with a test that fails on the reverse.
- [ ] No `reset --hard` and no `clean -fdx` anywhere on this path.
- [ ] An unlanded tree — uncommitted changes, unpushed commits, or a `PLOT-BLOCKED` marker — makes the agent create a new desk and leave the old one intact.
- [ ] A rejected claim push is logged loudly and named as a registry-lock violation, not swallowed.
- [ ] The manifest still names the branch and worktree the agent actually holds after a hop.
- [ ] Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, **plus** `cd packages/domain && npx tsc --noEmit` and `pnpm --filter @plot-pm/domain run test:corpus` — the root `typecheck` script is `pnpm --filter @plot-pm/board typecheck`, so it covers the **board only**.
- [ ] `pnpm build:board` run and the artifact committed.
- [ ] A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate, and it dispatches real workers into sandbox repositories. Two agents running it here produced 53 concurrent test processes, load average 8.69, and a board that could not answer a request in 25 seconds.

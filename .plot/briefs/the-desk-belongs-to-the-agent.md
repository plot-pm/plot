## Implementation brief — the-desk-belongs-to-the-agent (wave Saying so in the specs)

- **Plan (canonical):** `docs/plans/2026-09-02-an-agent-holds-one-desk.md` on `main`
- **Approved:** 2026-09-02, Jan Wloka, in-session
- **Branch:** `docs/the-desk-belongs-to-the-agent` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Wave 5 of five. **Two sentences, and neither was wrong when written.**

### What this branch owns

**`DESIGN-worktree.md:60` — the dispatcher no longer creates the desk.** It reads today:

> **The dispatcher creates it, the agent owns it.** `plot-dispatch.sh:1908` runs `git worktree add`, then `start_worker` — so the tree exists a moment before its agent does, and belongs to it from then on.

Two things are now false. **The citation has drifted:** `plot-dispatch.sh:1908` is inside the booking region — `bookbr="plot/start-$slug"` sits at `:1909` — and the fan-out `git worktree add` is at `:2503`, with the fallback attach at `:2505`. **And the claim is what this plan reverses:** the agent takes both ends of its desk's life, deciding create-or-reset when it takes a brief. Amend the sentence and fix the citation in one edit.

**Record the measurement that settled it: 2026-09-02, this estate — 2 manifests, 11 worktrees, 8 loop processes, 5 desks whose branch had already merged.** An identity issued once per agent was being issued once per slice. `DESIGN-agent.md:65` already stated the model the code did not implement — *"agent ──owns──► a worktree (its desk, while it lives)"* — and `plot-worker-loop.sh:723` created one per branch, with the only `worktree remove` in that block at `:731`, the race-loss path.

**`DESIGN-branch.md:52` — the push stops being *the whole* locking mechanism.** It reads today:

> *"The push is the claim, and it is the whole locking mechanism: pushing a ref that already exists is rejected, so two sessions racing for the same branch cannot both win."*

**That was accurate when written**, and say so: nothing assigned, every agent shopped through `--offline --next` at `plot-worker-loop.sh:716`, and git's refusal was genuinely all that prevented a collision.

**It is demoted, not deleted.** `DESIGN-branch.md:64` settles why it cannot be removed: *"A Branch is the only entity here whose source is git itself... a Branch **is** `refs/remotes/origin/<name>`."* An agent that works a branch pushes it, and git rejects a push to a ref that already exists and diverged — whether or not anything intends it as a lock. Once the registry assigns, the same refusal becomes a backstop that costs nothing and should never fire: **the relationship the reaper now has to desks.**

**And say what a firing means.** `plot-worker-loop.sh:729` treats a rejected claim push as ordinary — *"another worker won the race"* — and `:730`–`:732` remove the worktree and continue silently. Under this model a rejection is a registry bug reporting itself, and it must be loud, because the estate is protected only at the moment the invariant is already broken.

**Amend `DESIGN-branch.md:60` in the same pass.** It says *"The loser is not blocked — it asks `--next` again and takes another branch."* No agent selects its own work once the registry assigns, so there is no loser to describe.

**Check the two nearby claims that follow from the first sentence.** `DESIGN-worktree.md:64` says every one of the five refusals is a question about the agent or what it left behind, and none asks anything about the tree itself — **that stays true and needs no edit.** `DESIGN-worktree.md:292` tabulates `plot-worker-loop.sh` as *"`add` twice — a worker creates its own next tree"*; that line describes the defect this plan removes, so amend it or mark it as the measured before-state.

### What it does NOT own

**It changes no code, no script, and no test.** Documentation only.

**It does not write the create-or-reset guard.** `feature/an-agent-decides-create-or-reset` owns `plot-worker-loop.sh:723` and the base-then-branch checkout order.

**It does not remove `--offline --next`.** `feature/the-registry-queues-a-brief` owns `plot-worker-loop.sh:716` and the assignment lock. **Write the spec as the settled model, not as a description of the current tree** — these edits are allowed to lead the code, and the plan is the record that they do.

**It does not touch `DESIGN-agent.md:172` or `:483`.** Both already state this model; nothing in this plan contradicts them.

**It does not rename `Slice` or `Wave`.** `CLAUDE.md` records that defect as known with its own plan, and no new text may add to it. A **Slice** holds exactly one branch and belongs to one plan; a **Wave** is the fleet's cohort, spans plans, and is persisted nowhere.

**It does not touch the reaper's five refusals or `plot-release-refs.sh`'s five guards.** `feature/the-sweep-names-every-leftover` owns the sweep.

### Done when

- [ ] `DESIGN-worktree.md:60` says the agent creates or resets its desk, and its citation names a line that actually runs `git worktree add`.
- [ ] The measurement that settled it is recorded with its date: 2026-09-02, 2 manifests, 11 worktrees, 8 loop processes, 5 desks whose branch had already merged.
- [ ] `DESIGN-branch.md:52` says the push is a backstop that should never fire, states that it was the whole mechanism when written, and says why it cannot be removed.
- [ ] `DESIGN-branch.md:60` no longer describes a loser asking `--next`.
- [ ] `DESIGN-worktree.md:292` no longer states as current that a worker creates its own next tree.
- [ ] No hard-wrapped prose: one paragraph, list item, or table row is one line, however long.
- [ ] Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, **plus** `cd packages/domain && npx tsc --noEmit` and `pnpm --filter @plot-pm/domain run test:corpus` — the root `typecheck` script is `pnpm --filter @plot-pm/board typecheck`, so it covers the **board only**. A docs-only branch still runs the repo gates.
- [ ] `pnpm build:board` run and the artifact committed if the build changes it.
- [ ] A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate, and it dispatches real workers into sandbox repositories. Two agents running it here produced 53 concurrent test processes, load average 8.69, and a board that could not answer a request in 25 seconds.

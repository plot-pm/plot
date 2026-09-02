## Implementation brief — the-registry-queues-a-brief (wave Handing work over)

- **Plan (canonical):** `docs/plans/2026-09-02-an-agent-holds-one-desk.md` on `main`
- **Approved:** 2026-09-02, Jan Wloka, in-session
- **Branch:** `feature/the-registry-queues-a-brief` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Wave 3 of five.

### DO NOT START YET — this branch waits on `feature/the-registry-supervises-its-agents`

The plan carries `<!-- waits: feature/the-registry-supervises-its-agents -->` on this branch. **Check first whether that branch has merged.** `plot-pr-merged.sh` answers it the way the estate answers it everywhere — the host says merged, read from `mergedAt` and never `state`, never ancestry.

**If it has not merged: write a `PLOT-BLOCKED` file naming that branch as the prerequisite, and STOP.** Do not start the work and do not build a stand-in. `readAgentRegistry` in `packages/board/src/server/registry.ts` is a read over manifest files — **it cannot wait for anything**, so there is nothing here to hand a brief to until the daemon exists. Building a queue against a reader means building it twice, and the second build is the one that has to unpick the first.

The gate on that wave was *"stranded, reported, and still not picked up by a person"* measuring non-zero, and 2026-09-02 supplied it: 19 desks with merged PRs reaped by hand, 2 sitting as `unknown` agents until the operator pointed at them, 1 holding a `PLOT-BLOCKED` marker for 13 hours after a merge had answered its question. **The gate was lifted the same day** — so this waits on a wave that is startable, not on one that is parked.

### What this branch owns

**Dispatch hands slice + brief to the registry and returns.** `plot-dispatch.sh:2503` runs `git worktree add -q -b "$branch" "$wt" "origin/$MAIN"`, falling back at `:2505` to attaching an existing branch. **That call goes.** Dispatch stops creating a desk, stops waiting, and returns.

**Dispatch does not refuse on `0 free`.** An earlier draft of the plan proposed that refusal and it is wrong: it makes dispatch synchronous with fleet capacity, the coupling `DESIGN-machine.md` §10 spent two revisions rejecting. `DESIGN-agent.md:173` states the same property — *"a dispatch never asks the machine for capacity"*. **The queue absorbs the timing.**

**The brief gate moves from the launch to the hand-over.** `plot-dispatch.sh:2556` tests `brief_present "$branch"` and `:2561` calls `start_worker`; `:2562` is the `--no-brief` override that starts anyway and says so; `:2566`–`:2572` is the refusal that prepares without starting and then calls `request_brief`. **The gate's rule is unchanged — a slice with no brief is not handed over — and only its position moves.** `--no-brief` keeps its meaning: it hands over without one and says so, so the override stays on the record.

**The registry holds the queue and matches on the free event.** `free` becomes something an agent announces by naming no branch — wave 1's deliverable — not a state anything polls.

**The registry is the assignment lock, and there is only one.** It hands a slice to one agent and never hands the same slice out twice.

**`--offline --next` goes with it.** `plot-worker-loop.sh:716` calls `plot-fleet-scan.sh --offline --next "$PLOT_SLUG"`, and the agent stops shopping for its own branch — so it stops taking a branch without a work order. Two agents racing for one branch becomes unreachable rather than caught.

**Git's refusal is demoted, not deleted.** `DESIGN-branch.md:64` settles why: a Branch *is* `refs/remotes/origin/<name>`, so an agent that works a branch pushes it and git rejects a push to a ref that already exists and diverged. That refusal happens whether or not anything intends it as a lock. Once the registry assigns, it becomes a backstop that costs nothing and should never fire — the relationship the reaper now has to desks. `plot-worker-loop.sh:729` treats a rejection as ordinary; **`feature/an-agent-decides-create-or-reset` makes it loud, and this branch must not quietly restore the old reading.**

**The queue is derived, not stored** — the plan argues it and the daemon's own design agrees, specifying itself *"stateless across restarts by construction"*. An eligible slice with a brief and no claim *is* queued. **Settle it in the daemon's design, not here**, and if the daemon has settled it otherwise, follow the daemon.

### What it does NOT own

**It does not clear `branch` or define `free`.** `feature/an-agent-says-when-it-is-free` owns both. This branch consumes the free event; it does not produce it.

**It does not touch `plot-worker-loop.sh:723` or the create-or-reset decision.** `feature/an-agent-decides-create-or-reset` owns the desk's lifecycle. This branch removes `--next` at `:716`; that branch removes the `worktree add` at `:723`. **Both edit the same block — base on a `main` that contains it and read the merged shape before editing.**

**It does not sweep, reap, or delete anything.** `feature/the-sweep-names-every-leftover` owns leftovers, including the desks left by a dispatch that used to create them.

**It does not amend a spec.** `docs/the-desk-belongs-to-the-agent` owns `DESIGN-worktree.md:60` and `DESIGN-branch.md:52`, and the second of those sentences is exactly what this branch makes false.

**It does not answer what sets N.** The plan leaves it open: the machine measures pressure and reports it, the operator reads it when choosing N, and a queue longer than the pool is the normal case, not an error. If the code forces an answer, write `PLOT-BLOCKED` naming the question rather than inventing a policy.

### Done when

- [ ] `plot-dispatch.sh` no longer calls `git worktree add` on the fan-out path.
- [ ] Dispatch hands slice + brief to the registry and returns without waiting, and refuses nothing for want of a free agent.
- [ ] The brief gate refuses at the hand-over, with the same rule and the same `--no-brief` override, and still names the ref it looked at rather than a bare path.
- [ ] The registry hands one slice to one agent and never hands the same slice twice, asserted by a unit test.
- [ ] `plot-worker-loop.sh` no longer calls `plot-fleet-scan.sh --offline --next`.
- [ ] A rejected claim push is still logged loudly.
- [ ] Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, **plus** `cd packages/domain && npx tsc --noEmit` and `pnpm --filter @plot-pm/domain run test:corpus` — the root `typecheck` script is `pnpm --filter @plot-pm/board typecheck`, so it covers the **board only**.
- [ ] `pnpm build:board` run and the artifact committed.
- [ ] A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate, and it dispatches real workers into sandbox repositories. Two agents running it here produced 53 concurrent test processes, load average 8.69, and a board that could not answer a request in 25 seconds.

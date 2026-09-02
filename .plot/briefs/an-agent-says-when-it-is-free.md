## Implementation brief — an-agent-says-when-it-is-free (wave Naming what is free)

- **Plan (canonical):** `docs/plans/2026-09-02-an-agent-holds-one-desk.md` on `main`
- **Approved:** 2026-09-02, Jan Wloka, in-session
- **Branch:** `feature/an-agent-says-when-it-is-free` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Wave 1 of five. **Nothing else in this plan is reachable until an agent can say it is free.**

### What this branch owns

**Clearing `branch` when a slice finishes.** `plot-worker-loop.sh:699` calls `seal_declaration` the moment a branch is done, before `--next` is asked and before any hop moves `$PLOT_BRANCH`. `plot-worker-loop.sh:740` then calls `update_manifest_on_hop`, defined at `:183`, which rewrites `manifest.branch` and `manifest.worktree` to the next slice and bumps `wavesCount`. Between those two points the agent genuinely holds no slice, and the manifest says it still holds the last one. **Clear `branch` — and only `branch` — at the finish, so the window between finishing and being handed the next slice is observable.** The manifest at `.plot/agents/<session>.json` carries `session`, `resumeId`, `branch`, `worktree`, `command`, `pid`, `wrapperPid`, `workerMonitorPid`, `agentMonitorPid`, `buildMonitorPid`, `attempts`, `startedAt`; `branch` is the only field this slice writes.

**`free` is derived, and it is two facts that already exist.** `free = process alive AND manifest names no branch`. `packages/board/src/server/registry.ts:389` already reads `branch` leniently and defaults it to `''`; `:136` documents `''` as *"the branch it holds, or `''` while it holds none"*, and `:103` states that empty is a real value rather than a gap. So the type needs no change — the value needs to become reachable.

**Do not derive `free` from the tree.** `plot-worker-state.sh:46` derives `waiting` from a `PLOT-BLOCKED` marker and `:47` derives `stalled` from uncommitted or unpushed work, both read from the desk. Those are claims about work left behind. Under this plan the desk persists across slices, so a clean desk says nothing about whether its agent has been handed the next brief.

**Do not add an announced marker.** An agent that crashes between finishing and announcing is free and does not say so. `PLOT-BLOCKED` survives that objection only because a blocked agent is by definition still alive to write it.

**Make it observable where the board already reads.** `readAgentRegistry` in `packages/board/src/server/registry.ts` is the reader; `AgentState` at `:34` is `'running' | 'finished' | 'waiting' | 'stalled' | 'unknown'`, and `DESIGN-agent.md:483` states the gap those five leave: *"The process states do not say whether an agent is free."* `running` is not busy — an agent between units is running with no branch and is available. `finished` is not free — its worker exited and nothing marks the transition. **Availability is a second question, answered by the state plus its slice, and this branch is where it becomes askable.**

**The domain owns the derivation, not a component.** `CLAUDE.md` › The Layering Rule: every rendered state is a domain property. A `free` computed in `.tsx` can only be tested by rendering. Put the rule under `packages/domain/src/rules/` beside `eligible.ts` and `acting.ts`, take the readings as values, and assert it in a unit test.

### What it does NOT own

**It does not touch the desk.** `plot-worker-loop.sh:723` still creates a worktree per hop, and this branch leaves it there — `feature/an-agent-decides-create-or-reset` owns it.

**It does not remove `--offline --next`.** `plot-worker-loop.sh:716` stays exactly as it is. The `--next` shopping disappears when the registry assigns, which is `feature/the-registry-queues-a-brief`.

**It does not build a queue, a daemon, or an assignment lock.** Those wait on `feature/the-registry-supervises-its-agents`.

**It does not sweep anything.** `feature/the-sweep-names-every-leftover` owns leftovers.

**It does not amend a spec.** `docs/the-desk-belongs-to-the-agent` owns `DESIGN-worktree.md:60` and `DESIGN-branch.md:52`.

### Done when

- [ ] The worker loop clears `branch` when a slice finishes, and a test asserts the manifest names no branch in the window between `seal_declaration` and the hop.
- [ ] `free` is a domain property — process alive AND no branch — with a unit test that needs no browser and no live process.
- [ ] The board reads it from the registry it already reads, and a test asserts an agent between units reads free rather than `finished` or `unknown`.
- [ ] `update_manifest_on_hop` still rewrites `branch` and `worktree` on a hop; clearing is added, not substituted.
- [ ] Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, **plus** `cd packages/domain && npx tsc --noEmit` and `pnpm --filter @plot-pm/domain run test:corpus` — the root `typecheck` script is `pnpm --filter @plot-pm/board typecheck`, so it covers the **board only** and a domain type error passes it.
- [ ] `pnpm build:board` run and the artifact committed.
- [ ] A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate. Two agents running it here produced 53 concurrent test processes, load average 8.69, and a board that could not answer a request in 25 seconds.

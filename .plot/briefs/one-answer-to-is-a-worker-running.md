## Implementation brief — one-answer-to-is-a-worker-running

- **Plan (canonical):** `docs/plans/2026-09-27-one-answer-to-is-a-worker-running.md` on `main`
- **Approved:** 2026-09-27, jwloka, in-session after panel (round 2)
- **Branch:** `bug/one-answer-to-is-a-worker-running` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — PR review, CI green
- **Issue:** #1015

Single-slice plan: nothing waits on this branch and it waits on nothing.

**READ THE PLAN'S NOTES FIRST.** This plan went through TWO rounds and both earlier diagnoses were refuted by measurement. The mechanism below is the third and the only one that reproduces.

### What to build

Give the reaper a reading of whether an **agent** still runs at a desk, rather than only whether the wrapper's pid is alive.

`plot-worker-state.sh:863-873` asks whether a `claude` process descends from the wrapper. When none does, it refines the desk by the TREE into `finished`/`waiting`/`stalled`, and its own comment says why no exit file is involved:

> The wrapper is alive and the agent is gone. The DESK decides what that means … **No exit file exists: the wrapper has not exited.**

The reaper asks neither question — `grep -c 'plot_worker_agent_alive\|plot-worker.exit' plot-reap.sh` → **0**. It asks `ps` about the wrapper and stops, so every desk whose agent exited while its wrapper survived reads as live and can never be reaped.

Reproduced in a sandbox — live wrapper, no `claude` child, clean tree, branch pushed, **no exit record**:

```
plot_worker_state    = [finished|23768|]
plot-reap.sh reading:  PLOT_PID='23768' -> 'worker alive (pid 23768)'
```

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**TWO earlier diagnoses were wrong. Do not resurrect either.**

- **Not a stale pid file.** All three producers run `ps` before the rule sees the reading — `plot-reap.sh:506-509`, `:1040-1042`, `entities/worktree.ts:132`. `plot-reap.sh:503-504` states the contract: *"an empty pid file is not a live process, and which of those two it is is the rule's to say."*
- **Not a recycled pid, and not a missing exit-record read.** `plot-worker-state.sh:888` sits AFTER the `kill -0` branch returns, under *"The process is gone. What exit code did it leave?"* (`:880-882`). The exit record is read only when the pid is **dead**. Measured with an exit record present and the pid alive, `plot_worker_state` answers **`running`** — so `--stop` would have killed the recycled process rather than printing `finished`. **Adding only an exit-record reading closes NOTHING in the measured population, because the wrapper has not exited and there is no exit record to read.**

`finished` is the tell: on a live pid it is reachable ONLY through `plot_worker_agent_alive`.

**The reading is the fix; the rule is correct.** `reapProblems:89` is right as written. Change what the ADAPTER reads, not what the rule tests.

**Cite the right function.** The reaper imports `firstReapRefusal` (`plot-reap.sh:596`) → `reapProblems`. **`reapable.ts:441` is in `finishedWith` and is never executed by this subject** — two rounds of this plan argued about it. The two rules carry different refusal sets, which is exactly what hid the hazard below.

**Source `plot-worker-state.sh` whole, and map ONLY the process states.** Settled with the operator. Consume `running`, `finished`, `failed`, `ended`, `none`; **discard `waiting` and `stalled` BY NAME**. Those two are read from the desk and answer *what does this agent still owe*, which `uncommitted-changes` already answers. A mapping that consumed `stalled` would put an agent-side fact into a process-side decision — the confusion CLAUDE.md's Agent/Worker split exists to prevent.

**There is no layering objection.** An earlier draft argued *"a pure domain rule must not gain a shell dependency."* That refuted a design nobody proposed: the reaper is an ADAPTER and already spawns `node`, `git`, `ps` and `plot-pr-merged.sh`, and already sources shell helpers.

**THE UNPUSHED-COMMITS GUARD LANDS IN THIS SLICE.** `reapProblems` has **no `unpushedCommits` refusal** — its four are `live-worker`, `blocked-marker`, `uncommitted-changes`, `on-default-branch` — and the reaper supplies no `ahead` reading. Only `finishedWith` carries that guard and the reaper never calls it. **So widening *not live* widens what gets DELETED**, and a desk whose agent finished may hold committed-but-unpushed work that only this checkout has. MEMORY records that loss twice: *"324 finished lines sat uncommitted"* and *"a stalled worker exits 0 with uncommitted work"*. One slice does two things here deliberately, so that no intermediate commit can lose work.

If your commit-count call matches `scripts/check-ancestry-decisions.sh`'s pattern, declare it `# plot-ancestry: evidence` within five lines above.

**Both reading sites or neither.** `plot-reap.sh:506` (reap loop) and `:1040` (dirty sweep) carry the liveness snippet independently.

**The reported incident is NOT your test.** #1004, #1007 and #1014 are all `MERGED` 2026-09-26 and the deadlock was real, but the fact is unrecoverable: the worktrees are gone, all five agent manifests were deleted with them, there are no per-slug dispatcher logs, and `registryd.log` holds hand-overs only. **The sandbox fixture is the specification.** Do not spend time reconstructing the incident.

**`plot-worker-state.sh` is not flawless and is still out of scope.** On a manifest-less desk it has no `startedAt` and `:788-793` trusts `kill -0`. Note it in the PR if you touch that area; do not fix it here.

**`running` has three routes, and only one of them means an agent was seen.** `plot-worker-state.sh:859-877` answers `running` when the agent check succeeds, AND when `.plot-worker.wrapper.pid` is absent (`:859-862`), AND when `plot_worker_agent_alive` returns 2 — unaskable (`:874-877`). Return 2 covers a wrapper younger than `PLOT_AGENT_GRACE_SECONDS` (default 30, `:555`, `:588-592`), because it may be starting its agent. All three keep the desk, which is correct: absent is not false. Two consequences for the fixture: it MUST write `.plot-worker.wrapper.pid`, or the state reads `running` and the test proves nothing; and the wrapper must be older than the grace, or set `PLOT_AGENT_GRACE_SECONDS=0` in the test.

**The unpushed guard cannot count against `@{upstream}`, and this is measured.** `gh api repos/plot-pm/plot --jq .delete_branch_on_merge` → `true` (2026-09-27). The host deletes the branch when the PR merges, and the reaper only reaps desks whose PR merged. So after the next `git fetch --prune`, every desk the reaper serves has lost its upstream. `plot-dispatch.sh:2469` counts `@{upstream}..HEAD` and leaves an absent upstream empty, and `reapable.ts:338-342` reads that as `unknown`, which "does not hold the desk". **Copy that reading and the guard is inert on exactly the population it exists for**: every test with a present upstream passes and the guard protects nothing in production. Choose a reading that answers for a desk whose remote branch is gone, and write a test with the upstream deleted. Two candidates, each with a cost to state in the PR:

- `git rev-list --count HEAD --not --remotes` — the commits no remote-tracking ref holds. After a squash merge and a pruned ref, the branch's own commits are on no remote ref, so this counts them and refuses every merged desk unless the merged PR's head sha excludes them.
- The merged PR's head sha from the host (`headRefOid`) — anything on `HEAD` beyond it was never pushed. This is exact, but it needs a field `plot-pr-merged.sh` does not return today, and that script is the one answer to "did this land", so widening it touches four callers.

Whichever you choose, `unknown` must not delete: in this subject a failure to observe is the case that loses work, and the reset rule's leniency does not carry over.

**Out of scope:** `--stop` (it was right); the correction-file refusal (#1024); the supervision cause (#1030).

### Done when

The plan's `## Done when` list is the specification. Assertions a naive implementation passes without:

- **The fixture is live-wrapper / dead-agent / clean tree / NO exit record.** A test built around an exit record tests the refuted mechanism and passes without fixing anything.
- **A desk holding unpushed commits is NEVER reaped**, and the refusal names them. Test it twice: an unpushed commit on the desk, and uncommitted changes.
- **Both sites**, asserted by a test driving the sweep's counter as well as the reap decision.
- **A desk with a live agent is still kept**, and the refusal still names the pid — assert the pid string, not only a non-zero exit.
- **A test names `waiting` and `stalled` as deliberately discarded**, so a later reader cannot quietly widen the mapping.
- **The reaper and `--stop` agree on one fixture**, and the test names the agent-descendant fact as the reason.

Plus the repo's gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`, and `pnpm run test:board` if `reapable.ts` changes (it rebuilds the bundles the reaper imports). A `.changeset/*.md` with the description first and the `bumps:` block last, and a `plan:` line naming `docs/plans/2026-09-27-one-answer-to-is-a-worker-running.md`. Do not run `test:e2e` locally.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` and never with `gh pr create`.
- When the PR exists, append `(PR: #<number>)` inside the slice heading in the plan's `## Slices` section, on `main`, from a detached scratch worktree. The trailing `→ #N` form parses as no PR in a wave heading.

### Scope guard

This branch owns `skills/plot/scripts/plot-reap.sh` (both liveness readings, the new unpushed reading), `packages/domain/src/rules/reapable.ts` (one `unpushed-commits` refusal in `reapProblems` and the `TreeReadings` field it reads — no second liveness rule), and new tests under `test/reconcile/` beside `reaper.test.mjs`. It reads `plot-worker-state.sh` and must not change it.

**A known collision, verified 2026-09-27:** `bug/a-correction-is-not-unlanded-work` (#1024) edits the same two `plot-reap.sh` sites — the dirty filters at `:522` and `:1036`, a few lines below the pid readings at `:506` and `:1040`. Its agent is at a `failed` desk; its branch is claimed on the remote (`11d386f3`) and carries no file change yet. Whichever PR merges second rebases. Keep your edits to the pid readings and leave the `grep -v` lines alone, so the conflict stays mechanical. No other branch on the remote touches `plot-reap.sh`, `plot-worker-state.sh` or `reapable.ts`. `feature/one-monitor-watches-the-slice` touches `plot-dispatch.sh`, which this slice only reads.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

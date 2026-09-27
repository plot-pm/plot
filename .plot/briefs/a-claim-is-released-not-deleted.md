## Implementation brief — a-claim-is-released-not-deleted

- **Plan (canonical):** `docs/plans/2026-09-26-a-claim-is-released-not-deleted.md` on `main`
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)
- **Branch:** `bug/a-claim-is-released-not-deleted` (base: `main`) — claimed by ref push 2026-09-26
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — PR review, CI green
- **Issue:** #1003

Single-slice plan: nothing waits on this branch and it waits on nothing.

### What to build

A new `--release <branch>` verb on `skills/plot/scripts/plot-dispatch.sh`, beside `--stop` (`:272`, body from `:1663`) and `--restart` (`:277`). It returns an abandoned slice to the queue by clearing BOTH records of the assignment in one act:

1. the remote claim ref `origin/<branch>`, and
2. the `branch` field of every agent manifest in the `Agent registry` directory (`plot-config.sh get "Agent registry" ".plot/agents"`, resolved the way `:1122-1127` resolves it) whose `branch` names this branch.

The failure it fixes, measured 2026-09-26: `feature/the-board-filters-to-my-work` was handed out twice. An operator deleted a dead agent's claim ref by hand — the documented repair for *"still claimed, no commits → needs judgment"* (`plot-reconcile-scan.sh:1143`, `plot-reap.sh:958`). A later registry pass read the slice as claimable and handed it to a second agent, whose claim push was rejected: `REGISTRY LOCK VIOLATION` in `.worktrees/free-cf58119b/.plot-worker.log`. That agent abandoned a desk with unpushed commits and the slice produced nothing.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**The ref alone is not the assignment.** An earlier draft said the claim ref is the assignment's only durable record. Round 1 of the panel refuted it: the agent manifest carries the assignment too, and `clear_manifest_branch` (`plot-worker-loop.sh:350`) is its writer. A verb that deletes only the ref reproduces the defect. That is what the operator did by hand.

**Reuse the one manifest writer.** Do not write a second one: `clear_manifest_branch` sets `branch` to `""` via a scratch file and `mv`. It lives inside `plot-worker-loop.sh`, which is a script and not a library. So move it into a sourced helper that both the loop and the dispatcher source. `plot-worker-state.sh` and `plot-pr-merged.sh` are the precedent for "sourced, not run". Keep the loop's behaviour byte-identical.

**No manifest is not a failure.** The plan's own sequence says the dead agent had *"no desk, no manifest"*. `clear_manifest_branch` already returns 0 on an absent file. `--release` reports "no manifest named it" and still releases the ref.

**The daemon stays stateless.** Do not add an assignment journal to `plot-registryd.mjs`. A tick `kill -9`ed two seconds in is followed by a tick that reaches the identical decision with no state file. A journal adds a second recovery path, and it would itself need a release for a dead agent's entry. That is the same defect moved.

**Do not detect instead of prevent.** The claim-push backstop already detects the collision. Better reporting still costs one agent's slot and one abandoned desk per occurrence.

**Out of scope, by the plan's own list:** `matchQueue` (its invariants are per-pass and correct), the claim push in `plot-worker-loop.sh` (the backstop stays), `plot-release-refs.sh` (its race with a hand-over is a separate question), and any automatic judgement of which claims are abandoned. A person runs `--release`; nothing calls it for them.

**The refusals mirror `--restart`, including its order.** `dispatch-verbs.ts` (`restartWorker`, and the `BranchPrReading` doc at `:44-60`) records why the PR is asked FIRST: five of five `failed` worktrees held a PR. For `--release`:

- **A PR exists (open or merged) → refuse.** A merged branch belongs to `plot-release-refs.sh`, and an open one is work under review. Ask through `plot-host.sh`, never `gh` — `scripts/check-host-cli-callers.sh` gates that.
- **A live worker → refuse, naming the pid.** Use the shared `worker_state` / `plot-worker-state.sh` reading, the same measurement `--restart` makes. Never use `pgrep` by name.
- **Real work → refuse.** Real work means commits on `origin/<branch>` that `origin/main` lacks, OR a local desk (`worktree_for` / `held_worktree`, asked of git and not rebuilt from the name) holding unpushed commits or uncommitted changes. The measured victim abandoned exactly such a desk. A claim push lands `origin/main`'s tip, so a claim-only ref carries zero own commits. Before you merge, check whether your commit-count call matches `scripts/check-ancestry-decisions.sh`'s pattern. If it does, declare it `# plot-ancestry: evidence` within five lines above.
- **A `PLOT-BLOCKED*` marker on the desk → refuse.** That agent is waiting on a person, and its slice is not abandoned.

Everything refused leaves the ref, the manifests and the desk untouched. Name the command a person runs next.

**Order of the two writes.** Clear the manifest(s) first, then delete the ref. If the ref deletion fails, the manifest is already free and the ref still locks. That is the safe half-state: the scan still reads the slice as claimed, so nothing hands it out twice. The reverse order leaves the measured failure on disk.

**The controller gate must admit it.** `skills/plot/scripts/plot-controller-gate.sh:165-174` exempts `--stop`, `--restart`, `--start` and `--migrate` because they have no endpoint. `--release` has none either. Add it to that case arm and to `test/reconcile/controller-gate.test.mjs`, or the master agent cannot run it at all. Measured while writing this brief: the gate also fires on a plain `grep` whose command line names the script.

**Rules carried over:** absent is not false (no manifest ≠ error; an unreachable host ≠ "no PR" — refuse on an unreachable host, because a deleted ref cannot be re-created); read the exit code, not the emptiness; `trash` over `rm` in any test teardown you write by hand.

### Done when

The plan's `## Done when` list is the specification. Assertions a naive implementation passes without:

- **The re-assignment test must reproduce the MEASURED sequence**, not a simplified one: assign, kill the agent, `--release`, run a registry pass (or `plot-fleet-scan.sh --next`) that hands the slice to a second agent, and that agent's claim push SUCCEEDS with no `REGISTRY LOCK VIOLATION`. A test that only asserts "the ref is gone" passes on the hand-deletion that caused the defect.
- **A negative control in the same test:** delete only the ref (the old hand repair) and show the manifest still names the branch. Without it, nothing proves the manifest half is load-bearing.
- **Stop the reproduction if it does not match.** The plan says the second push was *rejected*, which requires something to have re-created the ref after the hand deletion. If the reproduction shows a writer other than the stale manifest doing that, write it in the PR and a `PLOT-BLOCKED` note. Do not widen scope to fix it.
- **The live-worker refusal names the pid** in its output. Assert the pid string, not only a non-zero exit.
- **Test the real-work refusal twice:** once with a commit on the remote branch, and once with an unpushed commit only on the local desk. The second case is the measured victim's shape.
- **`--stop` still keeps the claim.** Keep an existing test green, or add one. State the difference between the two verbs in `--help` and in `skills/plot-dispatch/SKILL.md`, where an operator reads it.
- Update the two messages that assume a release by hand: `plot-dispatch.sh:1174` (*"a claim nobody can release"*) and `:1702` (*"the claim stands until you release it"*). They now name `--release <branch>`.

Plus the repo's gates:

- `nvm use` (Node 24) or `corepack pnpm`
- `pnpm test`, `pnpm run test:contracts`, and `node --test test/reconcile/dispatch.test.mjs test/reconcile/restart.test.mjs test/reconcile/controller-gate.test.mjs` plus your new file
- `pnpm run typecheck` if you touch TypeScript
- Not `test:e2e`: that suite is CI's gate.
- A changeset with the description first and the `bumps:` block last: `'plot': patch`, `plot-dispatch: minor` (new verb), `plan: docs/plans/2026-09-26-a-claim-is-released-not-deleted.md`.
- Update the `plot-dispatch.sh` row in `CLAUDE.md`'s Helper Scripts table to name `--release`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`.
- Then append `→ #<number>` to the branch's heading line under `## Slices` on `main`. Use a scratch worktree on `origin/main`, not the shared main checkout.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-dispatch.sh` (the `--release` mode, its help text, and the two messages above)
- a new sourced helper for the manifest writer, plus the matching one-line change in `plot-worker-loop.sh`
- `skills/plot/scripts/plot-controller-gate.sh` (one case arm)
- `skills/plot-dispatch/SKILL.md` and its `README.md`
- `CLAUDE.md` (one table row)
- tests under `test/reconcile/`
- `.changeset/`

Optional: a `releaseClaim` decision in `packages/domain/src/workflows/dispatch-verbs.ts`, only if the script calls it through a bundle. `stopWorker`/`restartWorker` there have no caller outside their test, and a third uncalled rule adds to that gap.

In flight at dispatch (2026-09-26), checked against every remote ref:

- `feature/a-card-sends-its-plan-to-the-jury` (PR #1014) touches `skills/plot/scripts/board/plot-registryd.mjs`. That is the built artifact, so there is no overlap unless you rebuild the board.
- `feature/one-monitor-watches-the-slice` touches `plot-dispatch.sh`, but its PR #741 merged on 2026-09-06. It is a stale ref, not a collision.
- `changeset-release/main` (#978) touches `skills/plot-dispatch/SKILL.md` only through version bumps.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

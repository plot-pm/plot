## Implementation brief — an-assignment-is-read-where-it-is-recorded (slice 2: a release and a rejected push name the agent)

- **Plan (canonical):** `docs/plans/2026-10-01-an-assignment-is-read-where-it-is-recorded.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/a-release-and-a-rejected-push-name-the-agent` (base: `main`)
- **Ends as:** one PR to `main`. Open it with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`.
- **Review of the code:** a person reviews the PR. Issues #1039 and #1152.

Both slices this one waits on have merged: `bug/a-hand-over-is-checked-before-it-is-made` (#1252, 2026-10-03) and slice 1, `bug/the-queue-reads-the-assignment` (#1267, 2026-10-04). Nothing blocks this slice. Slice 1 already put `claimTip` and `orphanedClaims` in `packages/domain/src/rules/claim.ts` and `commitSubjects` on the refs port; this slice adds to both and rebuilds neither.

### What to build

Measured 2026-10-01 (`.plot/logs/registryd.log` lines 23794-23833): agent `8111e3ec` was handed `bug/a-closed-sprint-stops-filtering`, its claim push was rejected by a stale empty claim, and the loop printed `REGISTRY LOCK VIOLATION` about a second agent that did not exist. The loop then `continue`d with `$PLOT_BRANCH` still naming the agent's previous slice, so the branch-holding block ran that slice's prompt again in the desk that had just been reset onto the new branch. The prompt exited 0, `clear_manifest_branch` ran, and the supervisor handed the agent a second slice while its desk still held the first. An operator's `--release` then deleted the ref under the agent. Three defects, one path:

1. **`claimAnswer(readings)`** in `packages/domain/src/rules/claim.ts`. It classifies the ref's commits with the existing `claimTip` and takes `holders`, the ids of live agents whose manifests name the branch, the asker excluded. It answers `held-by-agent`, `work-on-ref`, `stale-claim`, `absent` or `unknown`, tested in exactly the plan's order: a live holder first, because it is the only case where two agents hold one slice. Write it as an arrow.
2. **`skills/plot/scripts/board/plot-claim-answer.mjs`**, a bundle. It reads the readings as JSON on stdin and prints the answer and the holders. Its source is a new entry beside `packages/board/src/server/entry/empty-claim.ts`, and its build block goes in `packages/board/build.mjs` beside the `plot-empty-claim.mjs` block. Add its row to `skills/plot/scripts/README.md`'s helper table (`scripts/check-helper-table.sh` is the gate). The plan says CLAUDE.md; that table lives in the README now.
3. **`--release` refuses a branch a live agent holds**, in `skills/plot/scripts/plot-dispatch.sh`. Today the live-worker refusal (`:2097-2108`) asks `plot_worker_state` of `release_wt` only, the worktree whose HEAD is the branch. An agent just handed the branch has not checked it out, so `release_wt` is empty and the refusal does not run. `named_manifests` (`:2069-2091`) already collects every manifest naming the branch; the new refusal asks, for each, whether the worker in the manifest's OWN desk is alive, whatever branch that desk holds. On `held-by-agent` it names each agent id and desk and writes nothing. The refusals at `:2022-2154` keep their order and wording.
4. **The loop's rejection path**, `skills/plot/scripts/plot-worker-loop.sh:3103-3116`. After a rejected claim push it fetches the branch, reads the commits with `git log --boundary --format='%m|%H|%T|%P|%at|%s'` over `origin/<main>..origin/<branch>` (the format `commitSubjectsOf` reads, `refs-git.ts:190`), reads the holders from the registry, and prints one of the plan's four messages. Today's `absent` message from #1252 stays for `absent` and `unknown`.

**Then the loop gives up the hand-over.** Before the `continue` at `:3116` it runs `clear_manifest_branch "$PLOT_MANIFEST_FILE"` on its own manifest and sets `PLOT_BRANCH` to empty. The loop already skips the prompt block when `PLOT_BRANCH` is empty (the guard near `:2628`), so the next pass reaches `wait_for_work` as a free agent. It does not run the previous slice's prompt and seals no declaration. The loop does not release the ref: slice 1's tick reports it as orphaned once it is older than one tick, and a person releases it.

### The decisions the plan settles — do not re-derive them

**The asker's own manifest names the rejected branch, so `holders` must exclude it.** The supervisor wrote the branch into that manifest before the push. A loop that counts its own manifest reads `held-by-agent` on every rejection, and the `stale-claim` line never prints. Exclude by the manifest this loop owns (`$PLOT_MANIFEST_FILE`), not by branch. The `--release` caller has no asker and excludes nothing.

**Clearing the own manifest is required, not tidiness.** Without it `assigned_branch` reads the rejected branch on the next pass and the loop pushes the same rejected claim again, forever. The plan says so in its last paragraph; a test for the loop must assert the manifest's `branch` is empty after the rejection.

**Liveness is the worker's, not the manifest's.** A manifest naming a branch whose worker is gone is not a holder; counting it holds the slice forever (#1039's negative control, `test/reconcile/release.test.mjs`). Slice 1 reads `running` or `waiting` (`queue-reading.ts:287-302`). The shell callers read the same fact through `plot_worker_state` of the manifest's `worktree`. A manifest with no desk on this machine is not a live holder here.

**`ClaimAnswer` already exists and means something else.** `rules/claim.ts` exports `type ClaimAnswer = 'absent' | 'claim-only' | 'work' | 'unknown'`, which is `claimTip`'s result and the plan's `refTip`. The plan names the new function `claimAnswer` and its answers differ. Do not widen the existing type: `orphanedClaims` and slice 1's tests depend on it having four members. Give the new rule's answer type its own name, say so in the PR body, and avoid `verdict`, which this estate reserves for a slice's wave eligibility.

**The claim vocabulary has one home.** `claimAnswer` calls `claimTip`, which calls `realCommits` in `rules/empty-claim.ts`. It never compares a `plot: claim ` subject. `scripts/check-claim-prefix-comparison.sh` fails a comparison anywhere else. The loop's `git commit -m "plot: claim …"` writes the subject and is not a comparison.

**The callers pass commits and never classify them.** Parsing the git-log stream is `commitSubjectsOf`'s job (`refs-git.ts:213`). Do not write a second parser in shell or `jq`: a second implementation is free to drift. Pass the raw stream to the bundle and decode it there.

**Plain `--release` stays the only delete.** `claimAnswer` answers, the bundle prints, the shell refuses. Nothing in this slice deletes a ref. The plan's non-goals hold: no change to `queueOfPlan`, `waits:`, `handOverCheck`, the board's display, or the existing `--release` refusals; the only new refusal is asked through the domain.

**Shell pays for itself.** `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice adds lines to two `.sh` files. Offset them in the same change by removing shell elsewhere, or by writing the decision in the domain and calling the bundle, as `--release` and the loop both do here. The gate stores no number and has no override. Measure with `scripts/check-shell-lines.sh --per-file` before you start.

### Done when

The plan's `## Done when` list is the specification, Slice 2 items. Assertions that exist because a naive implementation passes without them:

- **One `claimAnswer` case per row, plus the ordering cases.** `holders: ['a1']` with `refTip: 'work'` answers `held-by-agent`, not `work-on-ref`; `refTip: 'unknown'` with a holder still answers `held-by-agent`. Each catches a reordered test list. Domain branch coverage is 100% for `src/!(adapters)/**`, and an unreached branch fails the coverage gate.
- **The `--release` contract test uses a manifest naming the branch while its desk holds another branch.** It asserts the refusal names the agent, the manifest's `branch` is unchanged and `refs/remotes/origin/<branch>` still exists. This catches a refusal that reuses `release_wt` and so passes the case it was written for.
- **The `stale-claim` contract test asserts the absence of `REGISTRY LOCK VIOLATION` and the presence of the `plot-dispatch.sh --release <branch>` command.** Extend `test/reconcile/claim-push-rejection.test.mjs`: it already drives a real push against a bare origin. A second case with a live holder other than the asker asserts the violation line, which catches a message change that swallows the double-assignment report.
- **The `8111e3ec` replay.** A loop whose `PLOT_BRANCH` names a finished previous slice is handed a branch whose claim push is rejected. Assert the prompt does not run again, no declaration is sealed for the previous slice, the manifest `branch` is empty afterwards and the next pass waits. It must fail on `origin/main` today; run it there first (in a pristine worktree, never by reverting your own tree) to prove it does.
- **A holder-excluded-asker case.** One test where the only manifest naming the branch is the asker's own, asserting `stale-claim`. It catches an implementation that counts itself.
- A new shell test's `run()` clears `PLOT_UNATTENDED` in the child env.

Plus: `nvm use` (Node 24) first. Add a changeset with `'plot': patch` and a `bumps:` block naming the skills whose scripts change, plus `'@plot-pm/board': patch` for the bundle's entry; copy the format from `git log -- .changeset`, description first and `bumps:` last. **Commit no built bundle.** A PR carries no generated file under `skills/plot/scripts/board/` (`scripts/check-no-bundle-diff.sh`), and `main` builds them after the merge. Run `pnpm build:board` only to test locally, then restore the generated paths from the merge base before you push; the gate's refusal prints the command. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e`.

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's heading in the plan's `## Slices` section (the `(Branch: …, PR: #N)` form). Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/claim.ts` (`claimAnswer` and its answer type) and its test, the new bundle entry under `packages/board/src/server/entry/` and its block in `packages/board/build.mjs`, the `--release` refusal in `skills/plot/scripts/plot-dispatch.sh`, the claim-push rejection and the manifest clear in `skills/plot/scripts/plot-worker-loop.sh`, `skills/plot/scripts/README.md`, and the tests beside each (`test/reconcile/release.test.mjs`, `test/reconcile/claim-push-rejection.test.mjs`).

In flight, verified on `origin` at 2026-10-04: no remote branch exists for this slice, and none of the plan's other slices is open. Do not touch `rules/queue.ts`, `queue-reading.ts`, `orphanedClaims` or the `assigned` hold: slice 1 settled them. Do not touch `handOverCheck` or the `startAgents` check: #1252 settled them. Line numbers above are as of `1c67ea07b`; the loop and the release path move often, so re-measure the anchors with `grep -n` before you edit.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

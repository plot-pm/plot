# Deliverable lens: one-answer-to-is-a-worker-running

Position: refuted
Evidence: executed

Juror: deliverable lens. Subject: the diff of merge commit b17a3c47 (PR #1033), `git show -m --first-parent b17a3c47`, read against the seven "Done when" items.

## Executed

- `node --test test/reconcile/reap-agent-liveness.test.mjs test/reconcile/reap-merged-pr.test.mjs` on origin/main (Node 24.4.1): 13 of 13 pass.
- `npx vitest run test/reapable.test.ts test/worktree.test.ts` in `packages/domain`: 79 of 79 pass.
- A probe outside the repository (`/tmp`, deleted afterwards) that reused the liveness test's own fixtures (`desk`, `deadAgentWrapper`, `stubGh`) and ran `plot-reap.sh --dry-run` against two desks. Each desk held one commit that had been pushed and later deleted from the remote on merge, plus one commit that was **never pushed**:
  - A: the host names a merged `headRefOid` that the desk does not hold. Output: `would    feature/probe-squash-late    PR merged (squash)`. The never-pushed commit `4183ebd` is on the desk.
  - B: the host answer carries no `headRefOid`. Output: `would    feature/probe-nohead-late    PR merged (squash)`.

## Read only

- The diff hunks listed per item below. I read `plot-worker-state.sh`'s `running` classification but did not re-derive it beyond what the tests exercise.

## Per item

1. **A live wrapper whose agent exited is reaped, sandbox fixture as the test: SUPPORTED (executed).** `plot-reap.sh` `desk_worker_pid` replaces the `ps -p` read at the reap loop. The test `a live wrapper whose agent exited, with no exit record, is reaped` asserts the preconditions (wrapper answers `kill -0`, no `.plot-worker.exit`) and that the desk is removed under `--yes`. It passes.
2. **A desk with a live agent is still kept, and the refusal names the pid: SUPPORTED (executed).** The `running)` arm prints the pid. The test `a desk with a live agent is kept, and the refusal names the pid` passes.
3. **A desk holding unpushed commits is never reaped, and the refusal names them: REFUTED (executed).** The guard exists: `unpushed-commits` in `ReapRefusalSchema`, the `unpushed` reading in `reapProblems`, `desk_unpushed` in `plot-reap.sh`, and tests in `reapable.test.ts` and `reap-agent-liveness.test.mjs`. It fails to hold "never". When the host says merged and no merged head is present in the desk, `desk_unpushed` sets `list=""` (the "NO MERGED HEAD THIS DESK CONTAINS" branch, added by e9f1138f). A desk that also holds a never-pushed commit is then reaped. Probes A and B above reproduce this. The comment in the diff says the guard holds the merged-desk case only "whenever the merged head is one this desk has". That is a scoped guarantee. The Done-when item states an unconditional one. The merged test `a merged desk whose merged head this desk does not hold is reaped` covers only a desk whose commits were all pushed, so it does not exercise the gap. Scope note: `cat-file -e` checks object existence and not ancestry, so a local rebase after the push still keeps the desk. The gap needs a head object that is missing from the local repository, or a host answer that carries no head.
4. **Both reading sites covered, a test drives the sweep's counter and the reap decision: SUPPORTED (executed).** The dirty-sweep site at the old `dpid` block now calls `desk_worker_pid`. The test `the dirty sweep reads the same liveness` asserts `dirty_trees=1` and `owner: nobody` for the agent-less desk, and `dirty_trees=1` again once a live-agent desk is added. The reap-decision tests cover the other site.
5. **The reaper and `--stop` agree on one fixture, and the test names the agent-descendant fact: SUPPORTED (executed).** The test `the reaper and --stop agree, and the agent-descendant reading is why` asserts `finished`/`running` from `plot_worker_state`, the reaper's `would`/`keep`, and `--stop` answering `is not running (finished`.
6. **Five-to-one mapping in code, and a test names `waiting` and `stalled` as discarded: SUPPORTED (executed).** The `case` in `desk_worker_pid` has a separate `waiting|stalled) ;;` arm. The test asserts that arm by regex over the source, and it also asserts the classifier preconditions and that the desk readings keep both desks.
7. **`reapProblems` gains no second liveness rule; the change is in the readings: SUPPORTED (read).** The only `reapProblems` change is the `unpushed-commits` push after the merge gate. The `live-worker` check is untouched, and liveness changed only in `plot-reap.sh`'s reading.

## Verdict

Six items are delivered. Item 3 is delivered as a guard with a documented hole: a merged desk whose host-named head is absent from the desk is reaped even when the desk holds a commit no remote ever had. The Done-when text says "never", so the position is refuted. Two ways to close it: (a) amend the item to state the scoped guarantee, or (b) refuse (`unknown`) when no merged head resolves locally *and* `--not --remotes` lists commits newer than the PR's merge time. The person who owns the plan decides between them.

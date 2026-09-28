# Behaviour juror — one-answer-to-is-a-worker-running

Position: supported
Evidence: executed

## Executed

- `node --test test/reconcile/reap-agent-liveness.test.mjs test/reconcile/reap-merged-pr.test.mjs` on main (Node v24.4.1): tests 13, pass 13, fail 0 (96.9 s).
- `npx vitest run test/reapable.test.ts test/worktree.test.ts` in `packages/domain`: 2 files, 79 tests passed.
- Discrimination check: the new `reap-agent-liveness.test.mjs` copied into a detached `/tmp` worktree at the pre-merge parent `5ff24458` gives pass 1, fail 8. Only "a desk with a live agent is kept, and the refusal names the pid" passes there, which is correct for a "still kept" item. The worktree was removed afterwards.
- `scripts/check-host-cli-callers.sh`: "Host CLI callers: clean.", exit 0. `plot-pr-merged.sh` is exempt, and it now carries the new `gh pr list ... headRefOid` call in `pr_merged_heads`.

## Per item

1. **An agent-less live wrapper is reaped: SUPPORTED (executed).** The test "a live wrapper whose agent exited, with no exit record, is reaped" asserts that the wrapper answers `kill -0` and that no `.plot-worker.exit` exists. It then asserts `would` under `--dry-run` and removal under `--yes`. It passes on main and fails at `5ff24458`. The implementation is `desk_worker_pid` in `plot-reap.sh`, which sources `plot-worker-state.sh`.
2. **A live agent is kept, and the refusal names the pid: SUPPORTED (executed).** The test "a desk with a live agent is kept, and the refusal names the pid" matches `keep.*worker alive (pid <wrapper>)`, and the desk survives `--yes`.
3. **Unpushed commits are never reaped, and the refusal names them: SUPPORTED (executed).** `reapProblems` has a new `unpushed-commits` refusal (`reapable.ts`), and `ReapRefusalSchema` now has 6 members. The shell test with the upstream deleted matches `unpushed commits: <short sha>`. The unknown count keeps the desk (`unpushed commits: unknown`). The domain tests cover the list case, the `unknown` case, the empty case, the absent case and the ordering.
4. **Both reading sites are covered, and a test drives the sweep counter: SUPPORTED (executed).** The dirty sweep at `plot-reap.sh` now calls `desk_worker_pid`. The test "the dirty sweep reads the same liveness" asserts `dirty_trees=1` and `owner: nobody` for an agent-less desk, and `dirty_trees=1` again after a live-agent dirty desk is added.
5. **The reaper and `--stop` agree on one fixture, and the test names the agent-descendant reason: SUPPORTED (executed).** The test title is "the reaper and --stop agree, and the agent-descendant reading is why". It asserts `plot_worker_state` = finished/running, then reap would/keep, then `--stop` reports "is not running (finished" and does not kill the wrapper. One caveat: `--stop` runs only on the agent-less desk and not on the live one.
6. **The five-to-one mapping is in code, and `waiting`/`stalled` are discarded by name: SUPPORTED (executed).** `desk_worker_pid` has a separate `waiting|stalled) ;;` arm. The test asserts the classifier preconditions, that the refusals name the marker and the path and never `worker alive`, and it greps the source for that arm.
7. **`reapProblems` gains no second liveness rule: SUPPORTED (read and executed).** The diff to `reapProblems` adds only the `unpushed` branch. `live-worker` still reads `workerPid` alone. The liveness change sits in the shell readings (`desk_worker_pid`), and the domain tests pass.

## Only read, not executed

- Item 7 rests on reading the diff. No test asserts the absence of a second rule.
- The squash-merge fallback in `desk_unpushed` answers empty when the host names a merged head that the desk does not hold. This means a squash-merged desk with a commit made after the merge is reaped. The test "a merged desk whose merged head this desk does not hold is reaped" pins this behaviour, so it is by design. It is a residual gap in item 3 for squash merges, but not a failure of the item as the plan words it.

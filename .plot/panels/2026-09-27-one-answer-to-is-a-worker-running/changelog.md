# Changelog lens: one-answer-to-is-a-worker-running

Juror: changelog lens. Subject: PR #1033, merge commit b17a3c47, read with `git show -m --first-parent b17a3c47`.

Position: refuted
Evidence: executed

## Finding

The changeset claims a guard that the diff does not provide. `.changeset/one-answer-to-is-a-worker-running.md` says: "a new `unpushed-commits` refusal keeps any merged desk holding commits no remote has and names them". Done-when item 3 says: "A desk holding unpushed commits is never reaped". The shipped `desk_unpushed` in `skills/plot/scripts/plot-reap.sh` has an `else` arm. When no head that `pr_merged_heads` returns exists as an object in the desk, the arm sets `list=""`, so the refusal does not fire. The code comment in that arm says the guard holds a merged desk only "whenever the merged head is one this desk has".

A sandbox run (`/tmp/juror-changelog/probe.test.mjs`) reproduced this. The test uses the PR's own fixtures, with scripts pointed at this checkout. The desk pushes commit A. A second clone pushes B on top of A, and the desk never fetches B. The desk then commits `late.txt` locally and never pushes it. The host deletes the branch and answers `headRefOid` B. `git rev-list HEAD --not --remotes` on the desk lists the local commit. `plot-reap.sh --yes` printed `reaped   feature/probe-elsewhere   PR merged (squash)`, and the desk, with the only copy of that commit, was gone afterwards. The PR's own test `a merged desk whose merged head this desk does not hold is reaped` asserts the same shape on purpose. The changeset's "any" and the plan's "never" describe a stronger guard than the one that shipped.

## Done when, item by item

1. Wrapper alive, agent exited, desk reaped (sandbox fixture): **SUPPORTED**. `desk_worker_pid` maps `finished|failed|ended|none` to no pid. Test `a live wrapper whose agent exited, with no exit record, is reaped` passed when run.
2. Live agent kept, refusal names the pid: **SUPPORTED**. The `running` arm keeps the pid. Test `a desk with a live agent is kept, and the refusal names the pid` passed when run.
3. Unpushed commits never reaped, refusal names them: **REFUTED**. The `else` arm of `desk_unpushed` answers empty when the merged head is absent from the desk. The probe above reaped a desk that held a local-only commit. The named-commit case (`unpushed commits: <sha>`) works when the merged head is present, and its test passed.
4. Both reading sites covered, the sweep's counter asserted: **SUPPORTED**. Line ~594 of the reap loop and line ~1136 of the sweep both call `desk_worker_pid`. The test `the dirty sweep reads the same liveness` asserts `dirty_trees=1` and `owner: nobody`. It passed when run.
5. Reaper and `--stop` agree on one fixture, reason named: **SUPPORTED**. Test `the reaper and --stop agree, and the agent-descendant reading is why` passed when run. It asserts `finished` and `running` from `plot_worker_state` for the two desks.
6. Five-to-one mapping in code, `waiting` and `stalled` discarded by name: **SUPPORTED**. `desk_worker_pid` has its own `waiting|stalled) ;;` arm. A test greps the arm and asserts the marker and dirt refusals. It passed when run.
7. `reapProblems` gains no second liveness rule: **SUPPORTED**. The `reapable.ts` diff adds only the optional `unpushed` reading and the `unpushed-commits` refusal. The `workerPid` test is unchanged. The domain tests `reapable.test.ts` and `worktree.test.ts` passed when run (79 tests).

## Changelog text against the diff

- Plan `## Changelog`: "The reaper asks whether an agent still runs at a desk ... A desk whose agent is gone stops being held by its surviving wrapper." This matches the diff and is supported by execution.
- Changeset sentences 1 to 3 (the agent question, the wrapper outliving its agent, both reading sites, the five-to-one mapping): these match the diff.
- Changeset sentence 4 ("keeps any merged desk holding commits no remote has"): this overclaims. See the finding above.
- Changeset sentence 5 ("excludes the head the host merged ... a count that cannot be taken keeps the desk"): this matches. Test `commits that could not be counted keep the desk` passed when run. The sentence leaves out the third answer, which is that a merged head the desk does not hold counts as nothing unpushed.

## Also observed (read only, not executed)

`pr_merged_heads` calls `gh` directly and returns 1 when `gh` is absent. On a Bitbucket checkout, any merged desk whose commits are on no remote ref therefore reads `unpushed commits: unknown` and is kept. The changeset does not mention this. `scripts/check-host-cli-callers.sh` passes (executed), because `plot-pr-merged.sh` is on its exemption list.

## Executed versus read

- Executed: `test/reconcile/reap-agent-liveness.test.mjs` (9 of 9 passed), `packages/domain` vitest `reapable.test.ts` and `worktree.test.ts` (79 passed), `scripts/check-host-cli-callers.sh` (clean), and the sandbox probe under `/tmp/juror-changelog` (it reaped a desk that held a local-only commit).
- Read only: the plan, the changeset, the diff of `plot-reap.sh`, `plot-pr-merged.sh`, `reapable.ts` and `worktree.ts`, and the Bitbucket observation.

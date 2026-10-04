# Round 4 — estate

Position: amend

## What I read

- Read in full: `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` at `547816537`, `round3.md` and `round3-estate.md`. I read the amendment as `git diff 9f53bb90e 547816537`.
- Read in part: `rules/agent-state.ts:95-145`, `rules/task.ts:60-95`, `rules/desk-lifecycle.ts:60-120,150-215`, `entities/ending.ts:40-110`, `transitions/agent.ts:395-420`, `workflows/decision.ts` (every `kind:` line, `:220-300`), `workflows/supervise.ts:186-200`, `adapters/performer/perform-fs.ts:1-140`, `ports/performer.ts:1-80`, the operation lists of `ports/refs.ts`, `ports/trees.ts`, `ports/agents.ts`, `ports/processes.ts`, `ports/build.ts`, `ports/slice-spend.ts`, `packages/board/src/server/entry/registryd.ts:195-260`, `registryd-main.ts` (every `kind` line), `continue.ts:330-450`, `plot-worker-loop.sh` (`:229`, `:272`, `:375-450`, `:799-821`, `:1732-1812`, `:2470-2545`, `:2840-3137`), `plot-dispatch.sh:1478-1577,1840-1874` (with the Read tool), `plot-agent-manifest.sh` (function list), `test/reconcile/deskreset.test.mjs:92-126`, `test/reconcile/workerloop.test.mjs` (the ending-partition lines), `plot-reap.sh:142-148`, `ci.yml:312-318`, `plot-release-gate.sh:28-34`, `docs/shell-and-domain.md:28-31`, `skills/plot-dispatch/SKILL.md:200-206`.
- Ran only `sed`, `grep`, `wc`, `ls` and `git grep`. I ran no test and changed no file except this one.

## Round-3 findings

1. `agentState` with a PR: answered. Plan line 61 states the PR-first order, and `rules/task.ts:88` returns `finished` before `blocked` and `dirty`. Rows 74/75 and 76/77 are split by PR. The `deskState` column has a new problem (new finding 1).
2. The free-wait `bound` row: answered in fact. Lines 57 and 66 say today writes no ending (`plot-worker-loop.sh:2486-2489`). The choice of reason is a new problem (new finding 3).
3. `markerRecordsWork`: answered. Line 86 reads the commits, as `desk-lifecycle.ts:101-110` and `DeskReadings.fileChangingCommits` define.
4. The settle: answered by removal. The wait now compares the remote tip to the pushed commit by equality (line 94). `head_is_pushed` (`:1732-1737`) does its own fetch today, so the slice-1 replacement with `ls-remote` is a real saving.
5. `manifest-clear`: answered. Line 53 adds `assignment-clear` and gives the reason.
6. The third count: answered. Line 92 names `raise_manifest_attempts` (`:399`), the supervisor's `MAX_ATTEMPTS` and the `agent-attempt` kind.
7. The spawn's port: partly answered. `runBounded` moved to `performer`, but that port's own doc contradicts the plan's use (new finding 4).
8. The omitted writers: answered, except `.metadata_never_index` (`:3017`), which no row names. The correction count has no write kind (new finding 5).
9. `fetch` and `contains`: answered. `refs.contains` is at `ports/refs.ts:483`. The tip read is a new `ls-remote` operation, so no fetch is needed.
10. The ancestry kind: answered. Line 128 declares `evidence`.
11. The clock: answered. `PLOT_WAIT_STARTED` carries the free wait's start, and `WAIT_BUDGET_SECONDS` defaults to `WORKER_BOUND_SECONDS` at `:229`.
12. The desk's launcher: answered. Line 125 names the desk copy and the first-entry reading at `:799`, and `trees.list` (`ports/trees.ts:18`) exists to read it.
13. The `desk_hold_reason` tests: answered. Slice 1 keeps the function whole, and `deskreset.test.mjs:98-100` and `:118-124` assert exactly the two phrases.
14. The budget-spent ending: answered. Lines 57 and 81 state the change from `unstarted`, 1 (`:2852-2856`) to `blocked`, 0.
- Citations: all three fixed (`agent-state.ts:132-143`, 14 shell callers and 3 adapters, `contract/schema.ts`).

## New findings

1. **`none` is not a `deskState` answer, so four rows cannot be asserted as line 59 promises.** `DeskState` has seven values and `deskState` always returns one (`desk-lifecycle.ts:157-180`). Rows 65, 66, 67 and 79 write `none`. The rule's answers are:
   - Rows 65 and 79 (a live free loop): `working`, because `workerAlive` comes first (`:158`).
   - Row 67 (the manifest is gone, the loop has exited): `unplaced` (`:159`).
   - Row 66 (the free wait ran out): it depends on whether the desk was reset. If it was not, the desk still holds the finished slice's commits, `fileChangingCommits > 0` holds, and an unmerged PR reads `holding-work` (`:170-174`). That names a person for a desk whose work is pushed. If the PR merged, it reads `finished`. If the desk was reset onto the default branch, it reads `orphaned` or `finished`.
   The plan must state the rule's answer in each of these cells. The table test stops on these rows today.

2. **Row 79 moves today's desk reset and names no target.** Today a passing check leads to `seal_declaration` (`:2863`), `record_slice_spend` (`:2869`) and `clear_manifest_branch` (`:2884`), in that order, which the comments at `:2858-2883` argue for. The free wait follows (`:2970`). The reset comes only at take-up, as `reset_desk "$hop_wt" "$next_branch"` (`:2982`), onto the branch that was handed over. Row 79 writes `desk-reset` before the free wait, when no next branch exists. It also leaves out the declaration and the spend record. Either keep today's order (the reset at take-up) or name what the desk is reset onto, and say that the order changes. This choice also decides the row-66 answer in finding 1.

3. **`bound` for an expired free wait merges two endings that the estate keeps apart.** `ending.ts` defines actor `bound` as "the wall-clock watchdog", and every `bound` today means that a prompt was cut short. The shell argues at `:2490-2498` that the wait's ending "IS NOT ONE OF THE THREE": nothing was cut short. `workerloop.test.mjs:1267-1300` holds that split over the log lines. The plan names no actor for the new write. `endingIsAttributable` refuses actor `agent` for `bound` (`transitions/agent.ts:401-415`), so the actor would have to be `bound`, which records a watchdog that did not fire. Add a reason of its own, or name the actor and state why one reason covers both cases.

4. **`performer`'s doc says it starts processes that outlive the caller, and `runBounded` starts one that must not.** `ports/performer.ts:12-15` reads: "this one starts detached processes that outlive the caller". Plan line 119 cites those lines to keep `processes` read-only. Line 121 then requires `runBounded` to start the prompt *without* `detached`, in the caller's group, and to kill it on the loop's exit. The plan must rewrite that port comment as part of slice 3, or put the bounded run on a port of its own. Today it cites the comment for one half of the decision and contradicts it in the other.

5. **No production code applies the existing kinds the loop reuses, and the correction count has no kind.**
   - `perform-fs.ts:54-69` skips `worker-signal`, `agent-resume`, `agent-attempt`, `blocked-marker`, `manifest-clear`, `commit` and `push` on purpose. `registryd-main.ts:1096` and `:1137` apply only `agent-assign` and `worker-start`. So the `agent-attempt`, `agent-resume` and `blocked-marker` writes that `supervise.ts:179-200` decides have no applier on `main`. The JS loop would be the first applier of any of them. The ports table names ports and no applier. Slice 3 must name the piece that maps each `Write` to a port call, and where it lives.
   - `agent-resume` is emitted today only beside `agent-attempt`, as the supervisor's retry (`supervise.ts:190-200`). The loop's correction raises `correctionAttempts` (`raise_manifest_corrections`, `:443`), and no kind in line 53 carries that write. The three-count test (line 92) cannot check a count that no write names. Name the kind for the correction count. Also say that `agent-resume` now has two emitters, one of which raises no `attempts`.

6. **Two "new" `refs` operations sit beside readings that exist.** The main checkout's status (line 111, "`refs` status (new)") is a `trees` reading: `trees.statusSync(path)` returns `git status --porcelain` (`ports/trees.ts:165`), and `trees.isClean` (`:60`) and `trees.dirtyPaths` (`:98`) also exist. Only the pathspec limit is new. The new `refs.remoteTip` (line 110) sits beside `refs.remoteHead` (`:497`) and `refs.branchTips` (`:264`). Both are local reads that are only as current as the last fetch, and that is why a network read is new. State both facts, so slice 3 extends `trees` and does not add a third tip reading without a reason.

7. **The plan names the wrong mechanism for its #1250 fix.** Line 57 says "the supervisor reads no exit code, so exit 0 spends no relaunch attempt". The reader is the dispatch wrapper. It turns the exit code into a WorkerMonitor line: non-zero appends `gone` and 0 appends `clear` (`plot-dispatch.sh:1520-1531`). The board's attention rule then maps `gone` to "restart it" (`rules/attention.ts:95`). So `blocked`, `holding-work` and `checks-unanswered` all publish `clear`, and that is what removes #1250's crash label. The design holds. The plan should name this path, because slice 7's removal of the monitors must keep it.

## Brief versus plan

The convergence problem comes from one kind of sentence: a sentence that describes how the shell does something today, at a line number, as the reason for a design choice. Of the seven findings above, findings 1, 2, 3 and 5 are about decisions, and findings 4, 6 and 7 are about naming. All seven come from cells and parentheses that cite code.

**The plan keeps these, because a decision depends on them:**
- The table's **Readings, Decision and Ending, exit** columns. They are the specification. The two changed endings (line 57) belong with them.
- The **intent** of the last column, as the desk's exit kind (`person`, `re-read`, `reap`) and not as state names: "a person is named for this desk", "the desk is re-read", "the desk is reaped". The slice-2 test derives the state names through the two rules. A disagreement between a state name and the intent then stops the branch, and the plan does not have to predict the rule's output. Findings 1 and 2 show that this column is the one that drifts.
- The three counts and which party reads each (line 92), without line numbers.
- Equality, not ancestry, in the CI wait (line 94). The `0e64fafd` / `f743e573` example also stays.
- The index exception and its call count (line 98), the one-writer rule (line 100), and the process-group rule (line 121).
- The launcher's two modes and the exit 2 (line 123).
- The four restart conditions, the self-check and the `process.execve` floor (lines 126-131).
- Slice 6's thresholds and failure kinds (lines 194-205).
- The Motivation measurements, which are dated and re-checkable.

**These move to the slices' briefs, where an implementer checks them against the code of that day:**
- Every `plot-worker-loop.sh:NNNN` citation in Design: lines 57, 88, 90, 92, 96 and 125 (`:2486-2489`, `:2852-2856`, `:2327`, `:229`, `:399`, `:799`, `:1751`, `:2616`, `:2629`). The plan keeps the fact ("today a free wait writes no ending") and drops the line number.
- The **Port** and **Starting point** columns of the write table (lines 106-117), and the "exists / new" labels. The plan keeps one constraint: every write goes through a port with an adapter under `adapters/`, `processes` stays read-only, and the spawn ratchet does not grow. Each slice's brief chooses the operation against the ports of that day. Findings 4, 5 and 6 all sit in this table.
- The rule citations in the prose: `task.ts:88`, `desk-lifecycle.ts:158` and `:161-168`, `continue.ts:333` and `:446`, `agent.ts:401-415`, `ending.ts:96`. The slice-2 test proves them, and the plan does not need them.
- Slice 4's list of source-text assertions with line numbers (line 177), and the 10-file BuildMonitor count (line 178). The plan keeps the rule "a deliberate rewrite is named in the PR, and any other failure is reported and never rewritten to pass".
- Slice 7's reference sites (lines 211-214: `package.json`, `.gitignore`, `contract/schema.ts`, `manifest-stamp.ts`, `registry.ts`). The plan keeps what is removed, by name. It replaces the list with an acceptance check: `git grep -n 'plot-build-monitor\|buildMonitorPid'` finds nothing outside the changelog.
- The slice-1 shell-ratchet arithmetic (line 150). `check-shell-lines.sh` decides it in the PR.
- The Board-impact comment's line references (line 24).

## Reject?

No. Each finding is a correction to a cell or a named piece the plan leaves out. None of them contradicts the approach: one long-running process, a stateless domain workflow, the existing ending vocabulary with three additions, and the build connector for the wait. Slice 1 still stands on its own, as the open question at line 234 says. Approving it separately does not depend on any finding here.

## What holds

- **The Motivation counts, re-run at `547816537`.** 3,137 lines (`wc -l`). The four sourced helpers and the 52 functions are unchanged since round 3. `plot-agent-manifest.sh` holds `manifest_count` (`:49`), `raise_manifest_count` (`:67`) and `manifest_resume_id` (`:159`).
- **The `agentState` cells with a PR or a marker.** Rows 74, 75, 76, 77, 81 and 82 match `taskState` (`task.ts:88-92`) and `agentState`'s exit routing (`agent-state.ts:141-143`): exit 0 and any PR go through `taskState`, and a non-zero exit without a PR is `failed`.
- **The `deskState` cells for rows 74 to 77 and 81.** A marker gives `refused-with-work` or `refused-empty` before any merge (`desk-lifecycle.ts:161-168`). Unlanded work with no marker gives `holding-work`.
- **`/api/continue`.** It reads the marker before it spawns and refuses without one (`continue.ts:444-450`), so a `holding-work` desk is refused, as line 84 says.
- **The group stop.** `plot-dispatch.sh:1849-1867` signals `-<pgid>`, and `start_worker` runs under `set -m` (`:1505-1511`), so a non-detached prompt stays reachable.
- **`BuildPort.runForSha(branch, sha, limit?)`** is at `ports/build.ts:105`.
- **`EndingReasonSchema`** holds the seven reasons (`ending.ts:76-84`), and `endingIsAttributable` admits `agent` for three of them. Lines 55 and 148 name the right place to add `holding-work`, `blocked` and `checks-unanswered`.
- **The contract step** has `timeout-minutes: 12` (`ci.yml:316`), so the reason to keep the loop's files out of it holds.
- **`plot-release-gate.sh:30-33`** prints the "cannot find … run 'pnpm build:board'" message and exits 2. That is a precedent the launcher's no-bundle path can copy.
- **`plot-reap.sh:142-148`** says the transcript lives in the tree and goes with it, so the baseline must be collected forward (line 180).
- **`plot-dispatch/SKILL.md:204`** names `plot-worker-loop.sh` and `.plot/worker-prompt.sh`, as line 102 says.

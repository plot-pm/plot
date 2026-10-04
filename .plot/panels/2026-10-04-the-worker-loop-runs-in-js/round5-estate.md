# Round 5 — estate

## What I read

- Read in full: `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` at `56c995c29`, `round4.md`, `round4-estate.md`, and `docs/plans/2026-10-04-the-shell-loop-holds-unlanded-work.md` at `fce2c87e6`.
- Read in part: `workflows/decision.ts` (the `Write` union, `Decision`), `entities/workflow.ts` (`WorkflowName`), `adapters/performer/perform-fs.ts` (the `switch` and `BEYOND_THE_FILESYSTEM`), `ports/performer.ts`, `ports/processes.ts`, `ports/trees.ts`, `ports/agents.ts`, `ports/refs.ts`, `adapters/refs/refs-git.ts` (`contains`), `rules/desk-lifecycle.ts`, `rules/desk-manifest.ts` (`loopRegistration`, `deskManifest`), `rules/supervision.ts`, `workflows/supervise.ts`, `rules/checks-verdict.ts`, `rules/checks-reading.ts`, `packages/board/src/server/entry/registryd-main.ts` (the `kind` filters), `packages/board/build.mjs` (the shipped shell list), `plot-worker-state.sh` (the idle-watch functions), `plot-worker-loop.sh` (`desk_reset_refusal`, `seal_declaration`).
- Ran only `grep`, `git grep`, `git show`, `sed` and `ls`. I ran no test and changed no file except this one.

## Round-4 findings

1. `none` is not a `deskState` answer: **answered.** The column is now "who acts next", and slice 1's test derives the state names through the rules. The derivation has its own problem (new finding 2).
2. Row 79 moved the desk reset: **answered.** The plan keeps the reset at take-up, after the free wait, and the checks-pass row keeps the seal, the spend record and `assignment-clear`.
3. `bound` for an expired free wait: **answered.** The row keeps today's ending (none, exit 124), and `bound` keeps its watchdog meaning.
4. `performer`'s contract: **answered.** `boundedRun` is its own port, and `performer` keeps "starts detached processes that outlive the caller" (`ports/performer.ts:12-15`).
5. No applier and no correction kind: **answered.** `registryd-main.ts:1096` and `:1137` still apply only `agent-assign` and `worker-start`, as the plan says. The loop gets its own kinds, `correction-count` among them, and `performLoopWrites` carries them out. The type shape behind "exhaustive" is open (new finding 6).
6. `trees` and `remoteTip`: **answered.** `trees` reads the main checkout's status, and the plan states why `remoteTip` is new beside `remoteHead` and `branchTips`.
7. The #1250 mechanism: **answered.** The plan names the wrapper's `clear`/`gone` line and the attention rule, and slice 6 keeps that path.

## New findings

1. **The `blocked` ending writes no `blocked` declaration, so `supervise` would correct an agent that asked a question.** `supervise` reads the declaration in `.plot-worker.envelope.json`, never the `PLOT-BLOCKED` marker. `rules/supervision.ts:276-281` sends a `blocked` declaration to `needs-a-person`, and its comment states why: "`blocked` is a question, and a correction prompt is not an answer to one". Without that declaration, a dead worker falls through to `correct` with cause `declaration-absent` (`:299-320`), and `workflows/supervise.ts:186-200` emits `agent-attempt` and `agent-resume`. The shell loop writes a declaration only on a passed check (`seal_declaration`), never beside a marker. Today an agent-written marker leaves the loop alive and free, so the supervisor never reaches that desk. The JS loop ends there instead (row 73, a change the plan names), and the manifest still names the desk, so `supervise` now reads it. Row 78 (budget spent) has the same shape. The plan states `supervise`'s answer for `holding-work` and leaves it out for `blocked`. Decide that `blocked-marker-write`, or the `loop-end` that follows it, also writes a `blocked` declaration, so the estate's existing rule sends the desk to a person. Otherwise state that `supervise` answers `correct` here and why that is acceptable. A brief cannot make this choice, because it decides what the supervisor does to a stopped agent.

2. **"Who acts next" has no rule that turns four answers into one, and three rows name an outcome no rule returns.** Line 60 says the test derives the outcome through `agentState`, `deskState`, `deskLifecycle` and `supervise`, and that a disagreement stops the branch. For a dead worker, two of those rules answer, and they often disagree:
   - Row 74 (`holding-work`) and row 79 (`checks-unanswered`) have the same pair of answers: `deskLifecycle` gives exit `person` (`desk-lifecycle.ts:207-210`), and `supervise` gives `correct`. Row 74 names `supervisor` and row 79 names `person`.
   - Row 66 (manifest gone) names `supervisor`. `supervise` reads one entry per registered agent and nothing else (`workflows/supervise.ts:13`), so it never reads this desk; it reports the desk only in `unclaimed`, which "names no write" (`:215`). `deskState` answers `unplaced` (`desk-lifecycle.ts:159`), exit `person`.
   - Rows 70, 72, 73 and 78 name `continue`. No rule returns `continue`. A marker desk with work reads `refused-with-work` (exit `person`), and one without work reads `refused-empty`, exit `copy-then-reap` (`desk-lifecycle.ts:200`). For the empty case the rule says reap, not continue. `/api/continue` acts only when a person asks it.
   The plan must state the mapping: which rule's answer decides the column when they differ, or that the column records both answers. Without it, the slice-1 test has nothing to assert, and the implementer must choose a precedence that decides who owns a stopped desk.

3. **The JS loop does not append its endings to `endings.jsonl`, and slice 5 counts from that file.** The split plan makes the shell `write_ending` append each ending to `.plot/state/endings.jsonl` in the main checkout. Slice 5 counts kinds 1 to 3 "from `endings.jsonl` and the issues", for slices that run on `js`. No slice in this plan says the JS loop appends there. The `desk` port's list names "the ending", which is the desk's own ending file, and `plot-reap.sh` removes that file with the desk. Without the append, slice 5 compares the shell baseline against a `js` count that has no source, and the plan's own rule records that kind as "unmeasured, never as zero". Name the append in slice 2 (the `desk` port, or `loop-end`) or in slice 3.

4. **"`plot-worker-state.sh` stays whole" keeps functions that call the file slice 6 removes.** The plan's reason is that other shell scripts and domain adapters call the file. That holds for the file, not for its idle-watch functions. `plot_worker_idle_watch_pass` calls `plot_transcript_quiet_seconds` (`plot-worker-state.sh:946`), and `plot_worker_conversation_spoken` calls `plot_transcript_exists` (`:847-851`). Both helpers live in `plot-transcript-quiet.sh`, which slice 6 removes. `git grep` finds no caller of `plot_worker_idle_watch_pass`, `plot_worker_conversation_spoken` or `plot_worker_publish_finding` outside `plot-worker-loop.sh` and tests; the one in `plot-dispatch.sh:1383` is a comment. After slice 6 those functions have no caller and call undefined functions, and their failure reads as `unavailable`. `plot_worker_idle_now` keeps a caller, the corpus pair. Narrow the sentence: the file stays, and slice 6 removes the idle-watch functions that only the loop calls. That also pays toward the shell ratchet.

5. **Two exports are named `checksVerdict`.** `rules/checks-verdict.ts:80` (the BuildMonitor-findings rule) and `rules/checks-reading.ts:130` (the board's host-reading rule) both export `checksVerdict`, `ChecksReadings` and `ChecksVerdict`. `index.ts:73` exports only the second. The plan's sentences name the right files, but slice 1 ("beside the unchanged `checksVerdict`") and slice 6 ("the findings form of `checksVerdict`") name the function alone. A brief can carry this. The plan should name the file in both places.

6. **The plan does not say how the loop's kinds fit the one `Write` union.** `Decision.writes` is `readonly Write[]` (`workflows/decision.ts:371-381`), and `Write` is one closed union of 23 kinds (`:21-44`). `Decision` takes no write type parameter. If the ten loop kinds join `Write`, then `perform-fs.ts` throws "unrecognised write kind" at run time for each of them (`:180-182`) unless they join `BEYOND_THE_FILESYSTEM`, and a `switch` over only the loop's kinds is not exhaustive over `Write`. If they form a separate `LoopWrite`, `Decision` needs a type parameter. `WorkflowName` also needs `agent-loop` (`entities/workflow.ts:91-100`). This is an implementer's choice that a brief can carry; I note it because the plan's "a kind without a performer fails `tsc`" holds only for the second shape.

7. **"Its descendants, read through `processes`" names an operation the port does not have.** `ports/processes.ts` has `isAlive`, `workerState`, `startedAt` and `uptimeSeconds`. Only `workerState` sums descendants internally, for activity. Slice 2 adds a read operation that lists them. A brief can carry this. It is consistent with "`processes` stays read-only".

## The split

The split holds. The parent depends on three things the split plan delivers, and each matches:
- `holding-work` in `EndingReasonSchema` and its admission for actor `agent` (line 58, and row 74's "from `the-shell-loop-holds-unlanded-work`");
- `desk_reset_refusal` as the shell side of `resetRefusals`, which stays in `plot-worker-loop.sh:738` until slice 6 removes the body and `corpus/desk-reset.corpus.test.ts` together;
- `endings.jsonl` as the baseline's source (line 144).

Slice 1's `waits: infra/the-shell-loop-holds-unlanded-work` is right, because slice 1's table and enum test need the `holding-work` value. The branch exists on `origin` with its claim (`5d3f87972`).

Two small points. Both plans rewrite the doc comment on actor `agent` in `entities/ending.ts`. The parent's slice 1 extends what the split plan wrote, and the parent should say "extends". The `endings.jsonl` gap in finding 3 is the one place where the parent assumes the split covers more than it does: the split covers the shell loop only.

## Slice 2

Slice 2 is one deliverable a reviewer can check if `reexec` moves to slice 4. Every other piece in slice 2 has a test in slice 2: `performLoopWrites` against fixtures, the `desk` port, `refs.remoteTip`, and `boundedRun` with the group-stop test. `reexec` has no caller until slice 4's restart, and its only behaviour, keeping the pid, is a slice-4 test. A port with no caller for two slices is the shape this estate already recorded with `setSprintState` ("nine refusals, zero callers"). Slice 4 already names `reexec` and the `--self-check` through `boundedRun`, so moving the port there costs nothing.

One further point for the brief: slice 2's group-stop test "starts a loop and its prompt in one group", but no JS loop exists until slice 3. The test needs a stand-in parent that calls `boundedRun`, and the brief should say so.

## Reject?

No. Findings 1 to 3 are missing decisions, and each has an answer in the estate's existing vocabulary: the `blocked` declaration, a stated precedence between `deskLifecycle` and `supervise`, and one more append. None of them contradicts the approach.

## What holds

- **Every rule and function the plan names exists on `main` under that name:** `loopRegistration` (`rules/desk-manifest.ts:232`), `idleNow` (`rules/sample.ts:162`), `claimAnswer` (`rules/claim.ts:163`), `resetRefusals` (`rules/reapable.ts`), `gateFailures` (`rules/gates.ts:249`), `MAX_ATTEMPTS` (`rules/supervision.ts:17`), `deskState` and `deskLifecycle` (`rules/desk-lifecycle.ts:157`, `:233`), `endingIsAttributable` (`transitions/agent.ts:401`), `agentState` (`rules/agent-state.ts:132`), `taskState` (`rules/task.ts:87`), `supervise` (`workflows/supervise.ts:122`).
- **The ports and operations it names exist:** `BuildPort.runForSha` with GitHub Actions, Jenkins and fixture adapters; `refs.contains` (`ports/refs.ts:483`) whose adapter declares `plot-ancestry: evidence` (`refs-git.ts`); `refs.remoteHead` and `refs.branchTips`; `trees.list` and `trees.statusSync`; `agents`; `processes` as a read-only port.
- **The supervisor's appliers:** `registryd-main.ts` applies only `agent-assign` and `worker-start`, so the claim that no code carries out the supervisor's other kinds holds.
- **The corpus files and the gate the plan names exist:** `corpus/desk-reset.corpus.test.ts`, `corpus/agent-state.corpus.test.ts`, `corpus/sample.corpus.test.ts`, `scripts/check-state-declarations.sh`.
- **`PLOT_WORKER_LOOP_SOURCED`** has 41 matches, so slice 6's `git grep` acceptance check has something to find.
- **`plot-transcript-quiet.sh` is in the shipped shell list** (`packages/board/build.mjs:1290`, `packages/board/package.json:44`), and slice 6's `git grep` finds those references, so the acceptance check covers them.
- **The plan holds no line numbers.** It names decisions and rules, as its Design section says, and none of the findings above is about a line number.

Position: amend

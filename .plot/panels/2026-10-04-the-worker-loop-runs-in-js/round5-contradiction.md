# Round 5 — contradiction

## What I read

- Read in full: the plan at `56c995c29`, `the-shell-loop-holds-unlanded-work` at `56c995c29`, `round4.md`, `round4-contradiction.md`.
- Read in part, on `main` (`5890ee468`): `rules/supervision.ts` (the readings and `supervise`), `rules/gates.ts` (`notBlockedGate`, `ALL_GATES`), `entities/declaration.ts` (`isBlocked`, `isComplete`), `rules/desk-lifecycle.ts` (`DeskState`, `deskState`, `EXITS`, `deskLifecycle`), `workflows/decision.ts` (the `Write` union and its kinds), `adapters/performer/perform-fs.ts`, `entities/ending.ts`, `transitions/agent.ts` (`endingIsAttributable`), `ports/refs.ts` (`contains`, `remoteHead`), `adapters/refs/refs-git.ts` (`remoteHead`), `ports/build.ts` (`runForSha`), `board/src/server/continue.ts` (the marker refusal), `corpus/desk-reset.corpus.test.ts`, and the `correctionAttempts` and `desk_reset_refusal` sites in `plot-worker-loop.sh`.
- Ran no test. I changed no file except this one.

## Round-4 findings

1. **The changed endings: answered.** The table now has a "Today" column, and "Five rows change today's behaviour" names the marker, the spent budget, the unanswered wait, the moved tip and the unreadable tip. Each matches its row.
2. **The `unstarted` and `limited` markers: answered.** Rows 70 and 72 name `blocked-marker-write` and say "the same, marker included". The PR split went away with the state columns.
3. **The state cells that no rule returns: partly answered.** The plan removed the state columns. The new "Who acts next" column has the same defect in a new form (new finding 2).
4. **The unreadable tip: answered.** Row 81 and the CI-wait paragraph give a three-valued tip, and `unknown` keeps the wait inside `Checks wait`.
5. **`runBounded` on `performer`: answered.** `boundedRun` and `reexec` are their own ports, and `performer` keeps its contract.
6. **What `supervise` answers for the new endings: partly answered.** The plan states it for `holding-work` only. It does not state it for `blocked` or `checks-unanswered`, and it does not say whether the loop writes a `blocked` declaration (new finding 1).
7. **The PR-open reading and the index: answered.** The exception now names two readings, the PR-open state and the build.

## New findings

1. **`supervise` answers `correct` for every marker row and for `checks-unanswered`, and the table says otherwise.** `supervise` reads the declaration, not the marker or the ending. It goes to `needs-a-person` with `agent-blocked` only when `isBlocked(declaration)` holds (`rules/supervision.ts:280`). Otherwise the marker is one more gate failure (`notBlockedGate`, `rules/gates.ts:185`), the absent declaration is another (`supervision.ts:299-301`), and while `attempts < MAX_ATTEMPTS` the verdict is `correct` (`:320`). The loop seals a declaration only after checks pass (row 76). So rows 72, 73 and 78 (marker, "continue") and rows 79 and 80 (`checks-unanswered`, "person") all read `correct` from `supervise`. That is a retry of an agent that reported it cannot go on, which is the case the rule's own comment forbids: "resuming here would hand the agent back the problem it already reported it could not solve" (`:276-279`). Row 70 reads `needs-a-person` only if the start retries have already raised `attempts` to 2. The plan says slice 1's test derives "who acts next" through `supervise`, and "a row the rules answer differently stops the branch". As written, slice 1 stops on at least five rows. The approver needs one decision: either `blocked-marker-write` (and the `checks-unanswered` end) also writes a declaration with `status: blocked`, so `supervise` answers `needs-a-person`, or the column says `supervisor` for these rows and the plan accepts the retry.

2. **"Who acts next" names values that none of the four rules returns, and the plan gives no mapping and no precedence.** `supervise` returns `leave`, `reap`, `correct`, `needs-a-person` or `defer` (`supervision.ts:120`). `deskLifecycle` returns the exits `re-read`, `reap`, `detach-then-reap`, `copy-then-reap` or `person` (`desk-lifecycle.ts`, `EXITS`). Neither returns `loop` or `continue`, and `continue` is a board endpoint that a person calls, not a rule. The rules also disagree with each other on the same desk: on row 73, `deskLifecycle` answers `person` (`refused-with-work`) and `supervise` answers `correct`. On rows 70 and 72 with a fresh slice and no commits, `markerRecordsWork` is false, so `deskState` returns `refused-empty` and its exit is `copy-then-reap` (`desk-lifecycle.ts:166-167`): the desk is reaped after its marker is copied, and no one continues it. The plan must say how each rule's answer maps onto the column, and which rule wins when they disagree. Without that, the test author decides the table's meaning, which is the decision the approver is asked to make.

3. **Three of the loop's new write kinds duplicate kinds that exist, against a rule `decision.ts` states.** `BlockedMarkerWrite` (`blocked-marker`) already writes a `PLOT-BLOCKED` marker, and its doc calls the marker "the estate's existing *your turn* channel" (`workflows/decision.ts:300-315`). `AgentResumeWrite` is "ONE WRITE FOR BOTH PATHS" for a correction, because "two write kinds would ask every reader to remember that the correction is identical either way" (`:220-240`). `AgentAssignWrite` states "A SECOND WRITE KIND WOULD BE A SECOND ANSWER TO ONE QUESTION". `PushWrite` exists too. The plan adds `blocked-marker-write`, a correction as `prompt-run`, and `claim-push`. Its reason is that "no code on `main` carries out" the supervisor's kinds. That reason supports writing a performer for those kinds. It does not support a second kind for the same file. The plan must either reuse `blocked-marker` (and say why `prompt-run` and `claim-push` differ from `agent-resume` and `push`), or state that the loop's kinds are a separate union outside `Write` and why the one-kind rule does not cross it. That choice also decides whether `perform-fs.ts` must learn the new kinds: its `switch` throws on an unknown kind at run time (`perform-fs.ts`, `default` arm), so a shared union fails there, not at `tsc`.

4. **The kind list does not cover the table, so the exhaustive `switch` covers an incomplete list.** Row 76 decides "seal the declaration, record the slice's spend". No kind in the list seals a declaration or records spend. The `desk` port writes "the limited record" and "the moved worker record", and no kind names either. A workflow that decides row 76 has no `Write` value to say it with. The list must name a kind for each write the table decides, or the table must drop the write.

5. **The plan does not decide where `performLoopWrites` lives, and both places contradict a stated rule.** In the domain package, `perform-fs.ts` describes itself as "the only thing in this package that writes", so a second interpreter breaks that statement. In the board package, the supervisor's precedent is `registryd-main.ts`. There, slice 3's coverage block is scoped to `entry/worker-loop.ts` only, and the Coverage paragraph's claim ("each branch in it is either an adapter call or `agentLoop`'s answer") does not reach a `switch` in another file. The plan must name the package and say which coverage gate covers the interpreter.

## Does the split hold

Yes. Slice 1 waits on `infra/the-shell-loop-holds-unlanded-work` because it needs `holding-work` in `EndingReasonSchema`, which that plan adds. The two plans agree on everything they share:
- the ending, actor `agent`, exit 0, and the wrapper's `clear` line;
- `supervise` answering `correct` for that desk, and no performer carrying it out;
- the `endings.jsonl` baseline and its start at the split plan's merge;
- row 74's "the same" for the shell, and row 73's change (the split plan's test keeps today's path for a marker on a dirty desk, and the JS loop changes it).

Both plans rewrite the doc comment on actor `agent` in turn, which is no conflict. `desk_reset_refusal` lives only in the loop body (`plot-worker-loop.sh:738`), so slice 6 removes `corpus/desk-reset.corpus.test.ts` together with the shell side of its pair, which keeps "A Shell Script Asks The Domain".

## Is slice 2 one deliverable

Yes, if the plan decides finding 5. A reviewer can check it: the ports with their fixtures, an interpreter whose `switch` compiles over slice 1's kinds, and the process-group test. Two points need a sentence in the plan, not a cut:
- The process-group test "starts a loop and its prompt in one group", but no JS loop exists until slice 3. The plan must name the parent the test starts (for example a stand-in process that calls `boundedRun`), or move the test into slice 3.
- `performLoopWrites` has no caller until slice 3. That is acceptable for a port slice, but only if a gate covers it (finding 5).

## Is anything a reason to reject

No. Each finding is a missing decision or a misstated column, and each has a fix the plan can state. The direction holds against every rule I read.

## What holds

- `EndingReasonSchema` holds the seven values the plan lists (`entities/ending.ts:75-83`), and `endingIsAttributable` admits actor `agent` for exactly `unstarted`, `limited` and `unregistered` (`transitions/agent.ts`). Its test, that no watcher produced the ending, applies to `blocked`, `checks-unanswered` and `holding-work`.
- `refs.remoteHead` reads `refs/remotes/origin/<branch>` locally and makes no network call (`ports/refs.ts:486-497`, `refs-git.ts:569-584`), so a new `remoteTip` is needed. `refs.contains` exists and its doc says "Evidence, not a verdict", which matches the restart's `plot-ancestry: evidence`.
- `BuildPort.runForSha(branch, sha)` exists, with GitHub Actions, Jenkins, none and fixture adapters.
- `loopRegistration`, `idleNow`, `claimAnswer`, `resetRefusals`, `deskState`, `deskLifecycle` and both `checksVerdict` rules exist where the plan names them.
- `deskState` reads `holding-work` for a desk with file-changing commits, so rows 79 and 80 reach `person` through `deskLifecycle`, as the column says.
- `correctionAttempts` is a manifest field the shell raises apart from `attempts` (`plot-worker-loop.sh:404-444`), so the three-count rule describes today's counters.
- `/api/continue` refuses a desk without a marker (`continue.ts:446-455`), so the marker rows need the marker the table writes.
- The CI wait now compares by equality, declares both host readings as an exception, and keeps one writer of the PR index. That agrees with "A Decision Reads The Index" and "One Answer To Did This Land".

Position: amend

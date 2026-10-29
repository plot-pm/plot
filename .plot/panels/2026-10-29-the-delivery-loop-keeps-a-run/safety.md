# Juror verdict: safety

Position: amend

Evidence: Read the plan, `DESIGN-delivery-loop.md`, issue #2899 (`gh issue view`, read-only), `packages/domain/src/ports/notifier.ts`, `packages/fleet/src/shared/escalations.ts`, `packages/domain/src/rules/question-escalation.ts`, `packages/fleet/src/server/entry/registryd-main.ts` (`:1046`, `:2385-2410`, `:2543`, `:1515-1565`, `:2770-2800`), `packages/domain/src/adapters/supervision-report/supervision-report-file.ts:21-82`, `scripts/check-state-declarations.sh` header, and the sibling plans #2903 (`a-high-finding-is-fixed-before`), #2906 (`a-dead-desk-gets-a-fixer`), #2904 and #2901 for their run-log and attempts references. Ran `pnpm --filter @plot-pm/domain exec vitest run test/question-escalation.test.ts` (18/18 pass), which confirms the existing dedupe pattern the stall notification can reuse. I wrote no code against the run log, because no run log exists yet.

## (a) Problem statement

- The facts hold. `Notifier` is a port with one `notify(message)` operation (`ports/notifier.ts`). "registryd" is fleetd: `registryd-main.ts` prints `plot-fleetd:` and wires `notifierFor` at `:2405-2408` and `notifyEscalations` at `:2794`. The *Stalls* section of the design says what the plan says.
- **"This plan has no dependency" is false for stall arm 2.** "Spent both fixer attempts on the same finding" needs the attempts counter. #2903 owns that counter: its plan, lines 38 and 47, says "counted per PR … in a state file under `.plot/state/`", and #2906 line 47 says "#2903 decides the file shape". Arm 1 has no dependency. Arm 2 depends on #2903.

## (b) Approach, read against the anti-goal and the safety rules

This plan merges nothing, pushes nothing and starts no agent, so it cannot turn main red by itself. Its risk is that it creates the record every later loop plan writes to. A wrong contract here therefore becomes a wrong input for merge and fixer decisions later.

1. **The run log must never be a gate for an irreversible or single-writer step.** The design derives the merge-in-flight mark from "the default branch's head and its settled reading, not stored by fleetd", and it keeps attempts in their own state file. Open question 3 proposes reading "the same finding" from a run-log outcome. That is the first step toward the log becoming the attempts counter. The order of append and action matters on a crash:
   - If fleetd appends after the step and crashes between the step and the append, the log misses a fixer start. A counter that reads the log then allows a third attempt, and a second fixer can push to a branch where the first is still working. That breaks *one writer per branch*.
   - If fleetd appends before the step, the log shows a step that never ran.
   Amendment: state that the run log is advisory. Only the stall notification reads it, and a wrong answer there costs one message too many or too few. No merge, fixer, restart or revert decision may read it. This uses the same blast-radius split CLAUDE.md applies in *One Answer To "Did This Land"*.
2. **A missing line must never mean "stalled forever".** *A Decision Reads The Index* says "the index never says no". Several cases have no log line for an open slice: the first deploy, a file that was deleted or rotated, a slice dispatched before this plan shipped, and a log written on another machine. As written, arm 1 then fires for every open slice PR, which floods the person with notifications. A rule that only covers slices with at least one line has the opposite fault: it stays silent for a slice that stalls before its first step, which is the "loops silently" case the design forbids. Amendment: the subject set comes from the open slice PRs in the PR index, not from the log. For a slice with no line, the stall clock starts at a recorded fact such as the PR's `createdAt`, the dispatch, or the claim time, and this answers open question 2. A slice whose PR row reads MERGED or CLOSED leaves the set. This covers a person who merges or closes the PR by hand, so their action never produces a stall.
3. **A stopped fleetd must not cause a burst of notifications when it restarts.** A fleet that is stopped over a weekend wakes with every slice past the bound. Amendment: measure the age from `max(last step, fleetd's start time)`. `fleetd-start.json` already exists (`registryd-main.ts:213`, `:2353`). Another option is one aggregated message per tick.
4. **Two processes run the same tick.** The daemon waits after each tick, so its own ticks never overlap (`registryd-main.ts:1565-1568`). But `plot-fleetd.mjs --once` runs a full tick, including `notifyEscalations` at `:2794`, and nothing stops it from running beside the looping daemon. Escalation dedupe works in three steps: read the TSV and the per-process memory, send, append (`escalations.ts`; `registryd-main.ts:1528-1564`). Two processes can both pass the read before either one appends. The stall notification inherits this race, and two writers interleave run-log lines. Amendment: only the looping daemon writes run-log lines and stall notifications. `--once` reports what it would send and appends nothing. This follows `:2543`, "THE CHANNEL IS THE LOOP'S ALONE", and `:2392-2395`, "THE DAEMON IS THE ONLY WRITER".
5. **Send-then-record delivers at least once, and the plan should say so.** If the process crashes between `notify` and the append, the same stall is sent again after a restart. A duplicate message is harmless. The plan should name this behaviour so that no later plan treats a stall record as at-most-once. Key the dedupe like `recordedRungsFor(worktree, askedAt)`: the key is the slice plus the time of its last step. This answers open question 4 with one notification per stall episode, as the plan proposes, and `question-escalation.ts` already provides the rule shape.
6. **A failing host call is not progress.** Suppose every tick appends a line such as `pr-state: failed` or `unaskable` for a slice whose host calls keep failing. That slice then never stalls, because a line was written within the bound, and the loop runs silently again. Amendment: the stall clock counts only lines whose outcome moved the slice. A failed or partial host answer is logged but does not reset the clock. The outcome values need a `z.enum` that carries a `plot-state: classification` or `reading` marker, because `scripts/check-state-declarations.sh` refuses an undeclared enum.
7. **The path must follow the common git dir.** `escalations.tsv` sits under `repoRoot/.plot/state` (`escalations.ts:16`). The supervision report and the PR index sit under `--git-common-dir/.plot/state` (`supervision-report-file.ts:21`, `:41-82`). Later role agents run in worktrees, and the board may read this file. The plan only says "under `.plot/state/`". Amendment: name the common git dir. Otherwise a fixer in a worktree and fleetd in the main checkout write to two different logs.
8. **The file grows without a limit and the rule reads it on every tick.** The plan names no rotation, and rotation brings back the missing-line problem in point 2. Amendment: either the rule reads only the tail, or the log rotates by size and the rule treats a slice with no line as described in point 2.
9. **The layering, the shell ratchet and the spawn ratchet are clean.** `notifierCommand` already spawns inside an adapter, and the plan adds no shell. The plan cites *A Decision Reads The Index* for the log, but the log records fleetd's own steps, not answers bought from a host. Amendment: describe it as a record of what the loop did, not as an index, so that later plans do not take it as a licence to decide from it.
10. The plan writes no `plot/review` status, lifts no unattended refusal and merges nothing. The bypass, release and unattended rules are not affected.

## (c) Slices

- Slice 1 (run log) ships a writer with no caller from a loop step, because the loop steps belong to later plans. The *setSprintState* precedent in CLAUDE.md ("nine refusals, zero callers") warns against this. Amendment: slice 1 also logs the loop steps that already exist (auto-dispatch `auto-dispatch.ts:159`, a correction written `worker-loop.ts:1862`, a fresh session, auto-deliver `auto-deliver.ts:406`). Arm 1 then has real lines to read as soon as slice 2 merges.
- Split slice 2. Arm 1 (no step past a bound) can land now. Arm 2 (two attempts spent on one finding) must wait for #2903's rule-and-attempts slice and read #2903's attempts file, not the run log. Either add `<!-- waits: feature/a-high-finding-is-fixed-before-rule -->` to an arm-2 slice, or move arm 2 into #2903.

## (d) Open questions

- Bound key: `Stall after` in hours, beside `Claim stale after`, with `none` turning it off as `Question escalation` does (`question-escalation.ts`, `DEFAULT_QUESTION_ESCALATION`). Agreed.
- Where "no step" counts from: the last line that moved the slice. With no such line, count from the PR's `createdAt` or the claim time, and never from before fleetd's start (points 2, 3, 6). Do not use the last push: a desk that pushes forever without a green build has stalled too.
- "The same finding": do not read it from the run log. Read it from #2903's attempts file (points 1 and (c)).
- Re-notify: yes, once per episode, keyed by slice plus the time of the last progress line. Delivery is at least once (point 5).
- New questions the plan should carry:
  - Which process may write: only the loop, or `--once` too?
  - What does the rule answer while the default branch is red and the queue holds every slice by design? Each held slice would otherwise report a stall. Proposal: a hold is a step, or one "main red" message replaces the per-slice stalls. #2904 should agree.
  - Which `Notify command` result counts as recorded? `failed <code>` should allow a retry on the next tick, which `escalations.tsv` does not do today.

## (e) Tests

- Domain unit tests (vitest, `packages/domain/test/stall.test.ts`) over readings given as values:
  - No line for an open PR: the clock counts from `createdAt` and does not fire before the bound.
  - Every slice past the bound right after a fleetd start: no notification until the bound has passed since the start.
  - Only failed-outcome lines past the bound: fires.
  - A MERGED or CLOSED row: no stall.
  - An episode that is already recorded: not new. Episode key changed: new.
  - `none`: no stall ever.
- Fleet unit test in `registryd-tick` style: under `--once`, no line is appended and no notifier is called. In the loop, a notifier that throws does not end the tick. This mirrors the guard at `:2788-2797`.
- Adapter test: the log resolves through `--git-common-dir`, so a worktree and the main checkout write to the same file. The test removes its temp dir by the exact `mkdtempSync` name.
- Gate: `scripts/check-state-declarations.sh` passes with the new outcome enum declared.

## Amendments

1. State that the run log is advisory: only the stall notification reads it, and no merge, fixer, restart, revert or attempts decision may read it.
2. Take the stall subject set from the open slice PRs in the PR index. A slice with no line counts from `createdAt` or the claim time, and never from before fleetd's start.
3. Only the looping daemon appends run-log lines and sends stall notifications. `--once` reports and writes nothing.
4. Key the dedupe on slice plus last-progress time, reuse the `question-escalation` and `escalations.tsv` pattern, and state at-least-once delivery.
5. A failed or partial host answer does not reset the stall clock. Declare the outcome enum for `check-state-declarations.sh`.
6. Put the file under the common git dir's `.plot/state/`, and name how the rule handles growth or rotation.
7. Slice 1 logs the automatic steps that already exist. Arm 2 moves behind #2903's attempts slice and reads #2903's file.
8. Replace the *A Decision Reads The Index* framing with "a record of the loop's own steps".

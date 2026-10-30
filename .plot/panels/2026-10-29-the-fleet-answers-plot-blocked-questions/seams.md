# Juror verdict: seams (this plan against its nine siblings and the story design)

Position: amend

Evidence: Read the plan, issue #2901 (`gh issue view`), `DESIGN-delivery-loop.md`, and all nine sibling plans (#2898, #2899, #2900, #2902, #2903, #2904, #2905, #2906, #2907). Read code at the worktree's tree (4de186a03): `packages/fleet/src/server/entry/continue-command.ts`, `packages/fleet/src/shared/continuation.ts`, `packages/fleet/src/server/entry/registryd-main.ts`, `packages/fleet/src/shared/escalations.ts`, `packages/domain/src/rules/question-escalation.ts`, `packages/domain/src/rules/continue-target.ts`, `packages/domain/src/ports/agent-run.ts`, `packages/domain/src/adapters/agent-run/agent-run-command.ts`, `packages/domain/src/workflows/dispatch-verbs.ts`, `packages/board/src/server/restart.ts`, `packages/domain/src/adapters/tracker/tracker-plan-state.ts`. Ran: `PLOT_UNATTENDED=1 node skills/plot/scripts/board/plot-continue-command.mjs <unknown branch> probe` and the same for `plot-restart-command.mjs` (both refuse `unknown-branch`, exit 1); `vitest run test/question-escalation.test.ts test/continue-target.test.ts` (43 of 43 pass); `git grep` for every `PLOT_UNATTENDED`/`unattended` refusal under `packages/*/src`.

## (a) Problem statement

1. **The `continue` controller has no unattended refusal to lift.** The plan says "The controller lifts its unattended refusal only for a caller that declares itself as fleetd's" (Approach, para 3). `git grep -i unattend` over `continue-command.ts` (entry and shared), `continuation.ts`, `board/src/server/continue.ts`, `continue-target.ts` and `controller-gate.ts` finds nothing. The only unattended refusal among the three named controllers is `restart`: `dispatch-verbs.ts:194` and `board/src/server/restart.ts:68`. `merge` has none either (`workflows/merge.ts`, `entry/merge.ts`, `entry/ask.ts`: zero hits). The same false premise sits in sibling #2898 (Motivation: "The three controllers ... refuse every unattended caller"). The design's line 144 carries it too. This is a fact the design missed, so the plan may deviate.
2. **fleetd already calls the continue engine in-process, with no caller identity.** `registryd-main.ts:1927` passes `continueDesk: continueOnDesk` to `startFreshSession` for a spent desk (`registryd-main.ts:1657-1680`, `continuation.ts:29-37`: "what the registry tick calls for a desk whose ending earns a fresh session"). The plan does not name this path. It is the shortest route to an unattended answer.
3. **`escalations.tsv` gates nothing today.** It is the once-per-rung notification record (`escalations.ts:6`, `registryd-main.ts:1515`, `question-escalation.ts:42-55`). The desk waits because nothing continues it, not because of the file. The Changelog line "no longer gates anything" describes no change. The real question is whether the `15m, 1h, 4h` ladder still notifies a person while an unblocker answer is in flight; the plan does not say.
4. **The escalation key already identifies one question.** `QuestionReading.recordedRungs` is keyed by desk path and marker modification time (`question-escalation.ts:15-16`). That is the "once per question" key the plan's Start slice needs and does not name.

## (b) Approach, read against the siblings

**Duplicate deliverable 1: `.claude/agents/unblocker.md`.** This plan's Role slice builds it (`<!-- builds: .claude/agents/unblocker.md -->`). Sibling #2898's `feature/role-agent-definitions` builds "reviewer.md, fixer.md, unblocker.md, main-repair.md" with their hooks and the `.gitignore` entry, and its `feature/plot-init-provides-role-agents` ships all four. #2903 lists "the fixer role definition itself" as out of scope, and #2904 asks the same question for `main-repair.md` (its Open Question 2). Two plans that write one file conflict at merge. **Owner: #2898**, so that all four definitions share one hook set and one `/plot-init` path. This plan contributes the unblocker's charter text (what it reads, the "most reversible answer" rule, "never wait for a person") as input to #2898's slice, or as a later edit that waits on it.

**Duplicate deliverable 2: the answers list in the plan issue's Plot comment.** This plan's Record slice builds "the answers list in the plan issue's Plot comment". Sibling #2905's `feature/the-plan-issue-names-its-tickets` builds "each unblocker answer (question, answer, who answered)" in the same `planStateComment` (`tracker-plan-state.ts:44`). #2905 also says that the comment "is rebuilt from recorded state on every write" and that "this plan renders whatever record that plan [the unblocker plan] writes". **Split:** this plan owns the answers RECORD, a state file under `.plot/state/`. #2905 owns the RENDERING in `planStateComment` and the comment-size cut. Both plans carry the comment-size open question today; keep it only in #2905.

**Shared interface: fleetd's caller identity (#2898).** Given finding (a)1, this plan does not need the identity for `continue` unless #2898 ADDS a new refusal to `continue` for non-fleetd unattended callers. That change would alter behaviour for every unattended `continue` caller, and neither plan says so. Two coherent choices:
- (i) The unblocker returns its answer as a hand-back. `AgentRunResult` already carries `handBack` (`ports/agent-run.ts:150`). fleetd's tick then applies it through `continueOnDesk`, as `startFreshSession` does today. In this choice there is no caller identity, the record has one writer (fleetd), and the agent does not decide what happens next (design goal 4). Under this reading, "Writes one answer through `continue`" in the design's role table holds.
- (ii) The unblocker runs `plot-continue-command.mjs` itself. Then the identity is moot for `continue` today, and #2898 must say whether it adds a refusal.
Choice (i) removes a cross-plan dependency. The plan should name the choice, and #2898 should correct its premise.

**Shared interface: the agent-run port blocks.** `AgentRun.run` returns `Promise<PortResult<AgentRunResult>>` after the run ends (`ports/agent-run.ts:24`; `agent-run-command.ts` runs through `boundedRun`). fleetd's tick cannot await a sonnet run that takes several minutes on every pulse. This plan, #2900, #2903, #2904 and #2906 all start a role from fleetd's tick, and none of them names a detached start. **Owner: #2898's runner slice** (`feature/agent-run-takes-a-role`). It must give fleetd a start that does not hold the tick, plus a liveness reading per role run. The unblocker's "answer in flight" depends on that reading.

**Shared interface: the run log (#2899).** This plan says that the run log comes from #2899, but its slices never write to it. Its Open Question 2 proposes "record in the run log only". #2899's line has the fields slice, PR, head, step, outcome and time (#2899, Run log slice). It has no question key and no answer text, and a blocked desk often has no PR and no head. Either #2899's line format admits a question key and an empty PR and head, or this plan's answers record (above) is the record and the run log gets one `unblocker-started` and one `answered` step line. Name which.

**Shared interface: "desk dead" in `rules/slice-pr-next.ts` (#2900, #2903).** A blocked desk's worker has exited: per `CLAUDE.md`, `waiting` is read from the marker and "an exited process is a precondition". #2903's arms "HIGH, desk dead → start fixer" and "CI red, desk dead or corrections spent → start fixer" therefore fire on a desk that holds a `PLOT-BLOCKED` marker. In the same tick, this plan starts the unblocker, whose answer starts a new worker on the same branch. `continueTarget` refuses only `loop-alive` (`continue-target.ts:145`), and a fixer in its own worktree is not a desk loop, so nothing refuses the second writer. This breaks the design's *One writer per branch*. #2906 handles it for restart ("no `PLOT-BLOCKED` marker"), and #2903 does not. **Owner: #2900**, which introduces `slice-pr-next.ts`: the desk-liveness input counts a marker desk as held by the unblocker. This plan's `unblockerDue` must also skip a slice where a fixer run is live. Both rules then read one liveness reading, which #2898 supplies.

**Shared interface: the fixer attempts file (#2903).** Open Question 1 proposes "the correction budget (2) counts answers". `Correction budget` already counts failed builds per slice (`workflows/agent-loop.ts:235`, `entities/ending.ts:78`, `rules/merge-conflict.ts:23`), and #2903 counts fixer attempts in a separate file. A third meaning for one config key mixes up three counters. Count answers per marker key in this plan's own record, and do not reuse #2903's attempts file.

**Shared interface: the stall notification (#2899).** The "third question notifies a person" in Open Question 1 is a stall kind. #2899's stall rule names two kinds only: no step past a bound, and two fixer attempts on one finding. Either #2899 adds a third kind, "repeated question", or this plan sends through the `Notifier` port itself. Today the plan depends on a behaviour that no sibling builds.

**Review record:** this plan does not read it. No seam.

**Layering and shell ratchet:** `unblockerDue` as a readings-as-values rule in `packages/domain/src/rules/` fits. No new shell is implied.

## (c) Slices

- Role slice: remove it, or reduce it to "the unblocker's charter text", waiting on #2898's `feature/role-agent-definitions`. As written, it duplicates #2898.
- Start slice: keep it. It needs prerequisites that the plan does not annotate: #2898 runner (detached start, liveness), and #2898 definitions. It needs #2898 caller identity only under choice (ii) above.
- Record slice: narrow it to the answers record, and the change of the escalation ladder to a record if one is wanted. Move the comment rendering to #2905. #2905's tickets slice then waits on this slice, and #2905 should name that wait.
- Missing: the board's WAITING ON YOU change that the Board-impact comment names ("a blocked desk with an answer in flight is no longer waiting on a person"). No slice in this plan builds it, and no sibling builds it either (#2899 says the board reads nothing). It belongs in the Start slice or in a fourth slice of this plan.

## (d) Open questions

- OQ1 (loop bound): count answers per desk and slice in this plan's answers record, keyed like `escalations.tsv`. Do not use `Correction budget`. The notification needs #2899's stall rule to add a kind, or a direct `Notifier` send. Name which.
- OQ2 (no `Issue:`): the run log cannot hold the answer text as #2899 defines it. Keep the answers record as the durable home whatever the tracker, and let #2905 render it where an issue exists.
- OQ3 (comment size): this question belongs to #2905, which owns the rendering and already carries it.
- New: does the question-escalation ladder keep notifying a person at `15m, 1h, 4h` while an unblocker answer is in flight? The design says the ladder "stays, but as a record". Proposal: record the rungs and suppress the notification while a run is live.
- New: who writes the answer record when a PERSON answers first through `/api/continue` or `plot-continue-command.mjs`? "Who gave it" covers people too. The record write then belongs in `continueOnDesk`, which both routes and fleetd share (`continuation.ts:29-37`), and not in the unblocker.
- New: choice (i) or (ii) from section (b), the hand-back applied by fleetd or the agent calling the bundle.

## (e) Tests

- `unblockerDue` is a domain unit test (vitest, `packages/domain/test/`). Cases: marker and no record start one run. Marker and a live run start nothing. Marker and an answered record for the same mtime start nothing. A new marker mtime starts a run. A live fixer run on the slice starts nothing. The answer count past the bound gives a notification and still starts a run.
- `slice-pr-next` (#2900's test file): a marker desk with red CI or a HIGH answers "none" and not "start fixer". This seam test belongs in #2900 or #2903, and this plan should ask for it.
- Answers record: a fleet unit test on the file adapter, which writes, reads and tolerates a missing or unparseable file, as `escalations.test.ts` does.
- fleetd tick: a `registryd-tick.test.ts` case where a marker desk leads to one agent-run start through a fixture runner, and a second tick leads to none.
- Rendering: #2905's `tracker-plan-state` unit test over the answers record.

## Amendments

1. Drop the Role slice's `builds: .claude/agents/unblocker.md`. #2898 owns all four definitions. This plan supplies the unblocker charter text, or edits the file in a slice that waits on #2898.
2. Narrow the Record slice to the answers record (a `.plot/state/` file keyed by desk path and marker mtime: question, answer, author, time). Hand the Plot-comment rendering to #2905's `feature/the-plan-issue-names-its-tickets`, and name that hand-off in both plans.
3. Correct the premise that `continue` has an unattended refusal (`dispatch-verbs.ts:194` and `restart.ts:68` are the only ones). Choose and state either choice (i), where fleetd applies the unblocker's hand-back through `continueOnDesk` as `registryd-main.ts:1927` already does, or choice (ii). Under (i), drop the caller-identity dependency on #2898.
4. Name the prerequisites per slice: #2898 runner (a detached start and a role-run liveness reading, which #2898 must add) and #2898 definitions. Add #2899 only where the plan really writes run-log lines, and state those step names.
5. Add the seam with `slice-pr-next` (#2900, #2903): a desk that holds a `PLOT-BLOCKED` marker is not "dead" for the fixer arms, and `unblockerDue` skips a slice with a live fixer.
6. Replace "the correction budget counts answers" with an answer count in this plan's own record. Name who sends the third-question notification: #2899's stall rule with a new kind, or this plan through `Notifier`.
7. Add the WAITING ON YOU / fleet-payload change named in the Board-impact comment as slice work, and state whether the question-escalation ladder notifies while an answer is in flight.
8. Rewrite the Changelog's "`escalations.tsv` ... no longer gates anything": the file gates nothing today. State the behaviour that changes.

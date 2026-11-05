# Layering juror: partial-board-pulse-reported-as-unknown

Position: amend

## Findings

1. The plan's code claims hold on origin/main. `handleRestart` passes `(deps.pulse ?? pulseFor)(opts)` at `packages/board/src/server/restart.ts:67` and reads no completeness. `pulseFor` is `packages/board/src/server/fleet.ts:3301-3303`; its completeness companion `pulseCompleteFor` is `fleet.ts:3324-3326`, and its doc block (`fleet.ts:3305-3323`) says a plan absent from a partial pulse has not been reached. `restartBranch` refuses `unknown-branch` at `packages/fleet/src/shared/restart-command.ts:115-118`. The delivery gate passes completeness at `packages/board/src/server/deliver.ts:314`.

2. The plan does not name where the rule lives, and the existing lookup is outside the domain. `branchFromPulse` is `packages/fleet/src/shared/continue-command.ts:28`, `restartBranch` is `packages/fleet/src/shared/restart-command.ts:114`, and `ContinueRefusal` is `packages/fleet/src/shared/continuation.ts:99`. Approach step 3 says "one rule"; an unattended Sonnet agent will most likely add a branch inside `restartBranch` and the continue command in `packages/fleet/src/shared/`, which puts the decision in two places outside `packages/domain`. The precedent `deliveryPulse` is a domain rule (`packages/domain/src/rules/deliverable.ts:330`) that takes readings as values. The plan must name a domain rule (for example `packages/domain/src/rules/pulse-branch.ts`) with signature `(live, liveComplete, lastComplete, branch) => found | 'partial' | 'unknown'`, and the fleet commands must call it.

3. The plan ignores the recorded reading that already answers the question. `lastCompletePulseFor` (`fleet.ts:3343`) returns the last pulse whose scan finished, and `deliveryPulse` falls back to it (`deliverable.ts:341`). For restart and continue, a branch listed in the last complete pulse can proceed on that desk's record instead of refusing. That reads an existing index rather than refusing, and it removes the intervention rather than renaming it, which is the sprint goal. Open Question 3 ("retry after the scan completes") is answered better by this read than by a retry. The amendment: the rule consults `lastComplete` before it answers `partial`, and the plan states whether a desk from the last complete pulse is fresh enough to start a worker on (worker pid and worktree can be stale there; `restartWorker` re-reads the process table, so the risk is bounded, but the plan must say so).

4. The reader list is incomplete. Other branch or plan lookups over `pulseFor` that read absence as "not there": `packages/board/src/server/worker-log.ts:176` (`worktreeForBranch`), `packages/board/src/server/dispatch.ts:353` and `packages/board/src/server/implement.ts:258` (`startReadingFromPulse`, `packages/fleet/src/shared/dispatch-command.ts:74`). The plan must either include them or name them as out of scope with a reason, so the same defect does not stay in three readers.

5. A view decision exists in a component and the new refusal touches it. `refusalWord` (`packages/board/src/app/components/ContinueWithAnAnswer.tsx:34`) maps each `ContinueRefusal` to wording in `.tsx`. A new member forces a new case there. Under *Every rendered state is a domain property* the wording is not decided by the rule, so this is acceptable as rendering, but the plan should say the new case is wording only and that the agent panel's `reason` (`packages/board/src/server/agent-panel.ts:64,162`, its own union, not `ContinueRefusal`) gets the same member from the same rule.

6. The board-free entrances are left as an open question, and they are the fleet's own path. `plot-restart-command.mjs` and `plot-continue-command.mjs` read `.plot/state/last-pulse.json` (CLAUDE.md, *The Master Agent Uses The Controllers*). That file is written by a fleet scan and is a whole bridged pulse, so it is plausibly always complete; the plan must state that as a fact checked against the writer, or carry the completeness flag. This is the decision the slice cannot leave to the agent: if a person wants the bridged file to carry `complete`, that is a format change.

7. Shell: no change. The plan touches TypeScript only; `check-shell-lines.sh` is not at risk and no bash 3.2 or host CLI caller is added. The change buys no host answer, so *A Decision Reads The Index* is not violated; the lifecycle actions still pass through the restart and continue controllers.

## Amendments required

- Name the domain module and signature of the rule, and state that `restartBranch`, the continue command and `agentPanel` call it and decide nothing themselves.
- Make the rule consult `lastCompletePulseFor` before it answers the partial refusal, and pass it from the three board readers, as `deliver.ts:314` does.
- List `worker-log.ts:176`, `dispatch.ts:353` and `implement.ts:258` as in scope or as out of scope with a reason.
- Settle Open Question 2 by reading the writer of `last-pulse.json`, and record the answer in the plan.
- Settle Open Question 1 (name and status): `pulse-partial`, 409 with a retry hint, as a new `ContinueRefusal` member and a new agent-panel reason. A null pulse answers `pulse-partial`, never `unknown-branch`.
- Name the tests: a domain unit test with four cases (complete and listed, complete and absent gives `unknown-branch`, partial and absent with last-complete listing gives found, partial and absent everywhere and null pulse give `pulse-partial`), each failing on origin/main because the rule does not exist.

## Decisions for a person

- Whether a desk found only in the last complete pulse may be restarted or continued, or only named in the refusal.
- Whether `last-pulse.json` gains a completeness field.

## Ran versus read

Ran: `git show` and `git grep` over origin/main for `restart.ts`, `fleet.ts`, `continue.ts`, `agent-panel.ts`, `restart-command.ts`, `continue-command.ts`, `deliverable.ts`, `ContinueWithAnAnswer.tsx`, and every `pulseFor` caller. Read only: the plan, the brief and CLAUDE.md. Did not read issue #3118 or the writer of `last-pulse.json`. Ran no tests.

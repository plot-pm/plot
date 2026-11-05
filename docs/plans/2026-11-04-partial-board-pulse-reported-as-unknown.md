# Partial board pulse reported as unknown-branch

> A restart, a continue and the agent panel refuse `unknown-branch` for a branch that a partial pulse has not reached yet; they should look the branch up in the last finished scan, and name the partial reading where that scan does not list it either.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3118
- **Approved:** 2026-11-05, Jan Wloka, plan-PR #3127 merged
- **Started:** 2026-11-05, Jan Wloka, `feature/partial-pulse-names-itself`
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

`POST /api/restart`, `POST /api/continue` and the agent panel look a branch up in the last finished scan when the board's current scan is partial and does not list it, and refuse `pulse-partial` instead of `unknown-branch` when neither scan lists it.

<!-- Board impact: changes the board server routes `POST /api/restart` and `POST /api/continue`, the agent panel's miss reasons and the wording in `ContinueWithAnAnswer.tsx` and `AgentPanelFacts.tsx`. No change to the plan format, the template, the helper scripts or the `docs/plans` layout. -->

## Motivation

`POST /api/restart` refuses `unknown-branch: no plan on this board names that branch` for a branch that a partial board pulse does not list yet. The plan may name the branch. The scan did not reach that plan. The refusal states a fact about the plan that the board does not know, and a person must ask again after the scan finishes. The sprint goal (zero interventions by a person) counts that as an intervention.

Evidence on origin/main (issue #3118):

- `handleRestart` (`packages/board/src/server/restart.ts:64-73`) passes `(deps.pulse ?? pulseFor)(opts)` to `restartBranch` at `:67` and reads no completeness.
- `handleContinue` (`packages/board/src/server/continue.ts:122`, `:181`) passes `(deps.pulse ?? pulseFor)(opts)` to `continueBranch` and reads no completeness.
- `agentPanel` (`packages/board/src/server/agent-panel.ts:156-162`) calls `branchFromPulse(pulseFor(opts), branch)` directly and has no seam for the pulse.
- `pulseFor` (`packages/board/src/server/fleet.ts:3301-3303`) returns the cached pulse, which can hold only the plans that arrived before the scan was cut short. `pulseCompleteFor` (`fleet.ts:3324-3326`) says whether the scan finished; its doc block (`fleet.ts:3305-3323`) says "a plan absent from a PARTIAL pulse has not been reached", and that it reads `true` on a cold cache, where the pulse is `null`. `lastCompletePulseFor` (`fleet.ts:3343-3345`) returns the pulse of the last scan that finished.
- `restartBranch` (`packages/fleet/src/shared/restart-command.ts:114-119`) and `continueBranch` (`packages/fleet/src/shared/continue-command.ts:82-91`) cannot tell a partial pulse from a complete one, so they refuse `unknown-branch` for both.

The delivery gate already separates the readings: `deliver.ts:314` passes `pulseFor(opts)`, `pulseCompleteFor(opts)` and `lastCompletePulseFor(opts)` to the domain rule `deliveryPulse` (`packages/domain/src/rules/deliverable.ts:330`). The restart, continue and agent-panel readers do not. See also `2026-08-27-a-partial-pulse-does-not-say-not-merged` for the same defect in the Deliver gate.

## Design

### Approach

1. **One domain rule decides.** A new pure arrow function `pulseBranchReading` in `packages/domain/src/rules/pulse-branch.ts`, exported from `packages/domain/src/index.ts`, takes readings as values:

   ```ts
   export type PulseBranchReading =
     | { kind: 'listed'; pulse: FleetReading }
     | { kind: 'no-pulse' }
     | { kind: 'pulse-partial' }
     | { kind: 'unknown-branch' };

   export const pulseBranchReading = (
     live: FleetReading | null,
     liveComplete: boolean,
     lastComplete: FleetReading | null,
     branch: string,
   ): PulseBranchReading => …
   ```

   The rule answers in this order:

   - `live === null` → `no-pulse`. A null pulse stays `no-pulse`, as the Approved plan `2026-11-04-restart-refuses-unknown-branch-when-it` (#3100) and the Draft plan `2026-11-04-continue-and-the-agent-panel-refuse` (#3117, PR #3129) define it. This plan does not change that answer.
   - `live` lists the branch → `listed` with `live`. This holds for a partial pulse too, so a scan in progress never blocks a branch it already reached.
   - `liveComplete === false` and `lastComplete` lists the branch → `listed` with `lastComplete`.
   - `liveComplete === false` → `pulse-partial`.
   - otherwise → `unknown-branch`.

   "Lists the branch" walks `plans[].slices[].branches[].branch`, the same walk `branchFromPulse` (`continue-command.ts:28`) does. The rule returns the pulse to read; the fleet commands then call `branchFromPulse` on that pulse to build the desk. The desk shape (`PulseBranch`) stays in `packages/fleet`.

2. **The fleet commands call the rule and decide nothing themselves.** `RestartBranchInput` and `ContinueBranchInput` gain two optional inputs: `pulseComplete?: boolean` and `lastCompletePulse?: FleetReading | null`. An absent `pulseComplete` reads as `true` and an absent `lastCompletePulse` reads as `null`. Missing completeness information is never treated as partial.
   - `continueBranch`: calls the rule; on `listed`, calls `branchFromPulse(reading.pulse, branch)`; on any other kind, refuses with that kind as the reason.
   - `restartBranch`: calls the rule; on `listed`, uses `branchFromPulse(reading.pulse, branch)`; otherwise, where `input.worktree` is set (the `PLOT_RESTART_WORKTREE` fallback, `packages/fleet/src/server/entry/restart-command.ts:88`), proceeds with the `elsewhere` desk exactly as `restart-command.ts:116` does today; otherwise refuses with the rule's kind. The rule therefore runs after the worktree fallback in effect: it never adds a refusal where the current code proceeds.
3. **The board readers pass all three readings.** `handleRestart` and `handleContinue` pass `pulseComplete: (deps.pulseComplete ?? pulseCompleteFor)(opts)` and `lastCompletePulse: (deps.lastComplete ?? lastCompletePulseFor)(opts)`, as `deliver.ts:314` does. `RestartDeps` (`restart.ts:19-28`) and the continue route's deps (`continue.ts:63-64`) gain the optional seams `pulseComplete?: (opts) => boolean` and `lastComplete?: (opts) => FleetReading | null`, so a route test needs no board server and no scan.
4. **The agent panel renders the rule's answer.** `agentPanel(opts, branch, env, deps = {})` gains a fourth parameter with the seams `pulse`, `pulseComplete` and `lastComplete` (defaults `pulseFor`, `pulseCompleteFor`, `lastCompletePulseFor`). It calls `pulseBranchReading`; on `listed` it calls `branchFromPulse` on the chosen pulse; otherwise it answers `{ ok: false, branch, reason: <kind> }`. `AgentPanelMiss` (`agent-panel.ts:60-64`) gains `'pulse-partial'`. The wrong TSDoc line on its `'unknown-branch'` member ("The pulse knows the branch but reports no worktree path for it") becomes "No scan has reported this branch".
5. **The refusal.** `pulse-partial` joins `ContinueRefusal` (`packages/fleet/src/shared/continuation.ts:99`) with the TSDoc line "The board's scan has not finished, and neither it nor the last finished scan lists this branch." It answers HTTP 404, the status every lookup refusal uses, with the detail `the board's scan has not finished and the last finished scan does not name that branch; ask again after the next pulse`. The detail is true for the board cache, the only reader that can pass `pulseComplete: false`.
6. **Wording only in the components.** `refusalWord` (`packages/board/src/app/components/ContinueWithAnAnswer.tsx:34`) gains `case 'pulse-partial': return 'The board has not finished its scan, and the last finished scan does not name this branch — ask again after the next pulse.';`. `AgentPanelFacts.tsx:367` chooses its sentence by `panel.reason`; the slice turns the two-way ternary into one sentence per reason and adds `pulse-partial` → `'The scan in progress has not reached this branch yet — the next pulse may know it.'`. Neither component decides which reason applies.

### Decisions

- **Null pulse.** Stays `no-pulse` (#3100, #3117). This plan covers only a non-null pulse that is not complete and does not list the branch. Settled by the caller.
- **Partial pulse.** Look the branch up in `lastCompletePulseFor` before refusing; refuse `pulse-partial` only when that pulse does not list it either. Settled by the caller. The risk of a stale desk from the last finished scan is bounded: `continueOnDesk` (`continuation.ts:908`) refuses `no-question` for a desk with no marker, `no-manifest` (`continuation.ts:1012-1026`) for a worktree that no manifest names (a reaped desk), and the restart verdict re-reads the pull request and the process table before it starts a worker.
- **Name and status.** `pulse-partial`, 404, a new `ContinueRefusal` member and a new `AgentPanelMiss` member. Settled by the caller; 404 matches `unknown-branch`, `no-worktree` and `no-pulse`.
- **Retry.** None. The refusal names the reading; the route does not wait for a scan it does not own. Reason: a retry would start an agent later, against a pulse the person who asked never saw.
- **Board-free commands.** Out of scope. `plot-restart-command.mjs` and `plot-continue-command.mjs` read `.plot/state/last-pulse.json`, which carries no completeness field (`packages/domain/src/adapters/fleet-state/fleet-state-file.ts:24`, `:140-150`). They pass no `pulseComplete`, so they read as complete and keep `unknown-branch`. The README rows `skills/plot/scripts/README.md:85-86` do not change. Follow-up: #3136. Settled by the caller.
- **Other readers with the same blind spot.** `worker-log.ts:176`, `dispatch.ts:353` and `implement.ts:258` (verified on origin/main) read absence from a partial pulse too. Out of scope; follow-up #3137. Settled by the caller.

### Seams with other plans and pull requests

- Approved plan `2026-11-04-restart-refuses-unknown-branch-when-it` (#3100), slice `feature/restart-refuses-no-pulse`: edits `restart-command.ts:114-119`, `continuation.ts` (`ContinueRefusal`), `ContinueWithAnAnswer.tsx` (`refusalWord`), `continue-control.test.ts` and `restart-route.test.ts`. This slice waits on it and moves its inline `no-pulse` arm into the rule; its tests keep passing.
- Draft plan `2026-11-04-continue-and-the-agent-panel-refuse` (#3117, PR #3129), slice `feature/continue-refuses-no-pulse`: edits `continue-command.ts` (`continueBranch`), `agent-panel.ts` (`AgentPanelMiss`), `AgentPanelFacts.tsx`, `continue-command.test.ts`, `continue-route.test.ts` and `agent-panel.test.mjs`. This slice waits on it and moves its inline `no-pulse` arms into the rule; its tests keep passing.
- #3109 (`bug/an-answer-records-its-true-author`, open) edits `continuation.ts`, `ContinueWithAnAnswer.tsx`, `continue.ts` and `continue-command.ts`. The restart slice already waits on it, so this slice reaches it through that chain.

## Slices

### Refusal

- `feature/partial-pulse-names-itself` <!-- waits: feature/restart-refuses-no-pulse --> <!-- waits: feature/continue-refuses-no-pulse --> — the domain rule `pulseBranchReading` chooses between `listed`, `no-pulse`, `pulse-partial` and `unknown-branch`; restart, continue and the agent panel pass `pulseCompleteFor` and `lastCompletePulseFor` to it <!-- builds: the partial-pulse refusal for restart and continue -->

Files the slice changes:

- `packages/domain/src/rules/pulse-branch.ts` — new; `pulseBranchReading` and `PulseBranchReading`, arrow function, factual TSDoc.
- `packages/domain/src/index.ts` — `export * from './rules/pulse-branch.js';`.
- `packages/domain/test/pulse-branch.test.ts` — new; the rule's unit cases.
- `packages/fleet/src/shared/restart-command.ts` — `RestartBranchInput` gains `pulseComplete?` and `lastCompletePulse?`; `restartBranch` calls the rule; the TSDoc at `:102-113` names `no-pulse`, `pulse-partial`, `unknown-branch` and `no-worktree`.
- `packages/fleet/src/shared/continue-command.ts` — `ContinueBranchInput` gains the same two inputs; `continueBranch` calls the rule; its TSDoc names the four refusals.
- `packages/fleet/src/shared/continuation.ts` — `ContinueRefusal` gains `'pulse-partial'` with its TSDoc line.
- `packages/board/src/server/restart.ts` — `RestartDeps` gains `pulseComplete?` and `lastComplete?`; `handleRestart` passes both readings.
- `packages/board/src/server/continue.ts` — the deps gain `pulseComplete?` and `lastComplete?`; `handleContinue` passes both readings.
- `packages/board/src/server/agent-panel.ts` — `agentPanel` gains the `deps` parameter and calls the rule; `AgentPanelMiss` gains `'pulse-partial'`; the `'unknown-branch'` TSDoc line is corrected.
- `packages/board/src/app/components/ContinueWithAnAnswer.tsx` — `refusalWord` gains the `pulse-partial` case.
- `packages/board/src/app/components/AgentPanelFacts.tsx` — one sentence per miss reason, `pulse-partial` included.
- `.changeset/<name>.md` — `plot` patch; the description is the Changelog line above, first; no `bumps:` block is needed.

Tests that fail on origin/main and pass after the change:

- `packages/domain/test/pulse-branch.test.ts` — five cases, each fails because the module does not exist: (a) partial live pulse without the branch, last complete pulse without it → `{ kind: 'pulse-partial' }`; (b) partial live pulse without the branch, last complete pulse lists it → `{ kind: 'listed', pulse: lastComplete }`; (c) complete live pulse without the branch → `{ kind: 'unknown-branch' }`, also when `lastComplete` lists it; (d) partial live pulse that lists the branch → `{ kind: 'listed', pulse: live }`; (e) `live === null` → `{ kind: 'no-pulse' }`, with `liveComplete` both `true` and `false` and with a `lastComplete` that lists the branch.
- `packages/fleet/test/unit/restart-command.test.ts` — new: `restartBranch({ opts, pulse, pulseComplete: false, lastCompletePulse: null, branch: 'nope', caller: 'person' })` with a non-null `pulse` that omits the branch refuses `{ kind: 'refused', status: 404, reason: 'pulse-partial' }`.
- `packages/fleet/test/unit/continue-command.test.ts` — new: the same inputs to `continueBranch` refuse `{ status: 404, reason: 'pulse-partial' }`.
- `packages/board/test/unit/restart-route.test.ts` — new: `handleRestart(request({ branch: 'nope' }), res, opts, { pulse: () => pulse, pulseComplete: () => false, lastComplete: () => null })` answers `{ status: 404, body: { ok: false, reason: 'pulse-partial', branch: 'nope' } }`.
- `packages/board/test/unit/continue-route.test.ts` — new: the same deps through `post` answer 404 `pulse-partial`.
- `packages/board/test/unit/agent-panel.test.ts` — new: `agentPanel(opts, 'nope', {}, { pulse: () => pulse, pulseComplete: () => false, lastComplete: () => null })` answers `{ ok: false, branch: 'nope', reason: 'pulse-partial' }`. It spawns nothing: the miss returns before `uptimeSeconds` and `readConfigAsync`.
- `packages/board/test/unit/continue-control.test.ts:58-65` — add `'pulse-partial'` to the `reasons` list, so `renders a distinct sentence for each` covers it. Before the change the list entry fails typecheck because the member does not exist.

Tests that pass before and after, and guard the order:

- `packages/fleet/test/unit/restart-command.test.ts` — new: `restartBranch({ opts, pulse, pulseComplete: false, lastCompletePulse: null, branch: 'nope', worktree: '/w/nope', caller: 'unattended' })` refuses `unattended` (409, `continuation.ts:917-919`), not `pulse-partial`. Name it `a named worktree still restarts past a partial pulse`. It touches no file system. It fails against an implementation that refuses on the rule before the `input.worktree` fallback.
- `packages/fleet/test/unit/restart-command.test.ts` — new: a partial pulse whose last complete pulse lists `no-desk` with an empty `local_worktree` refuses `no-worktree`, not `pulse-partial`, which proves the desk is read from the chosen pulse.
- `packages/fleet/test/unit/restart-command.test.ts:49-52` and `packages/board/test/unit/restart-route.test.ts:52-56` — a non-null pulse without the branch and no completeness input still refuses `unknown-branch`. Unchanged; this proves an absent `pulseComplete` reads as complete.
- The `no-pulse` tests the two sibling slices add — unchanged.

Checks the slice runs before it pushes:

- `pnpm --filter @plot-pm/domain exec vitest run test/pulse-branch.test.ts`
- `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`
- `pnpm --filter @plot-pm/fleet exec vitest run test/unit/restart-command.test.ts test/unit/continue-command.test.ts`
- `pnpm --filter @plot-pm/fleet exec tsc --noEmit -p .`
- `pnpm --filter @plot-pm/board exec vitest run --project parallel test/unit/continue-control.test.ts test/unit/restart-route.test.ts test/unit/continue-route.test.ts test/unit/agent-panel.test.ts`
- `pnpm run typecheck` — board types change (`refusalWord`, `AgentPanelMiss`).
- `node skills/plot/scripts/board/plot-local-checks.mjs` and what it prints, including the `scripts/check-*.sh` gates.

The slice adds no shell lines, so `scripts/check-shell-lines.sh` is unaffected. It commits no generated bundle (`scripts/check-no-bundle-diff.sh`): `board-server.mjs` and the command bundles are built on main.

## Notes

Created from tracker issue #3118 by `/plot-idea`, unattended; stopped at Draft. The plan answers the issue and writes nothing to the tracker.

- Panel round 1: `.plot/panels/2026-11-04-partial-board-pulse-reported-as-unknown/panel.md` (four jurors, unanimous amend).
- Follow-ups: #3136 (completeness field for the fleet bridge pulse), #3137 (the same blind spot in the worker log, dispatch and implement).

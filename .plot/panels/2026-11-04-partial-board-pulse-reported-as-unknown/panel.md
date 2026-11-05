# Panel moderation: partial-board-pulse-reported-as-unknown

Plan PR #3127, issue #3118, round 1. Four jurors: layering, safety, testability, seams. Position: unanimous amend.

## Positions

| Juror | Position | Central finding |
|---|---|---|
| layering | amend | The rule has no domain home; it must consult `lastCompletePulseFor`; three more readers share the blind spot. |
| safety | amend | The rule must not add a refusal before the `input.worktree` fallback; a null pulse is not a partial pulse; no retry. |
| testability | amend | The plan names no test; the routes and `agentPanel` need seams; Approach step 4 contradicts the Approved restart plan. |
| seams | amend | Approach step 4 contradicts #3100 and #3117; the slice needs `waits:` markers on two sibling slices. |

## Disagreements

- **The last finished scan as a source of the desk.** Layering asks the rule to consult `lastCompletePulseFor` and proceed with that desk. Safety says the partial arm must never look the branch up there, because a stale pulse can name a desk that `/plot-reap` has removed. The caller settled for layering. The plan records the bound safety's concern needs: `continueOnDesk` refuses `no-question` for a desk with no marker and `no-manifest` for a worktree no manifest names (`continuation.ts:1012-1026`), and the restart verdict re-reads the pull request and the process table before it starts a worker. A start in a reaped directory therefore ends in a named refusal.
- **Null pulse.** Layering asks that a null pulse answer `pulse-partial`. Safety, testability and seams ask that it stay `no-pulse`, as #3100 (Approved) and #3117 (PR #3129) define it. The caller settled for `no-pulse`.
- **HTTP status.** Layering proposes 409 with a retry hint. Safety names 409 or 503 as safe. Seams proposes 404 to match the sibling convention. The caller settled for 404.
- **Rule home.** Layering requires `packages/domain/src/rules/`. Seams and testability accept either the domain or the fleet shared module. The caller settled for a domain rule; the plan names `packages/domain/src/rules/pulse-branch.ts`.
- **Reader scope.** Layering names `worker-log.ts:176`, `dispatch.ts:353` and `implement.ts:258`. No other juror names them. The caller moved them to follow-up #3137.

## Shared blind spots

- No juror checked whether fleetd ever writes a partial pulse to `.plot/state/last-pulse.json`. `packages/domain/src/adapters/index.ts:182` says fleetd writes the bridge on the scan's success path; no test asserts it. Follow-up #3136 carries the question.
- No juror checked that the `agentPanel` miss arm returns before `uptimeSeconds` and `readConfigAsync` spawn. The moderator verified it (`agent-panel.ts:161-167`), so the new unit case spawns nothing.
- No juror named a test for the case "partial pulse, last complete pulse lists the branch with no worktree", which proves the desk comes from the chosen pulse. The plan adds it.

## Juror claims checked against origin/main

All line references the plan uses were re-read on origin/main at `fbf670eaf`: `restart.ts:19-28`, `:67`; `continue.ts:63-64`, `:122`, `:181`; `agent-panel.ts:60-64`, `:156-162`; `fleet.ts:3301-3345`; `restart-command.ts:114-119`; `continue-command.ts:28`, `:82-91`; `continuation.ts:99`, `:908`; `deliver.ts:314`; `deliverable.ts:330`; `ContinueWithAnAnswer.tsx:34`; `AgentPanelFacts.tsx:367`; `continue-control.test.ts:58-65`; `entry/restart-command.ts:88`; `fleet-state-file.ts:24`; `worker-log.ts:176`; `dispatch.ts:353`; `implement.ts:258`. Safety's claim that both `AgentPanelMiss` doc comments are swapped is half true: only the `'unknown-branch'` line is wrong; the `'no-worktree'` line is correct. The plan corrects the one wrong line.

## Ran versus read

- layering: ran `git show` and `git grep` over origin/main; read the plan, the brief and CLAUDE.md; did not read issue #3118 or the bridge writer; ran no tests.
- safety: ran `gh issue view 3118`, `git show` and `git grep` over origin/main; ran no tests, board or fleet command.
- testability: ran `git show`, `git grep`, `gh issue view 3118` and `gh pr list`; ran no test suite.
- seams: ran `gh pr list`, `gh pr diff` for #3129, #3105, #3109, #3112, `gh issue view 3118`, `git show` and `git grep`; did not check the bridge writer; ran no test.
- moderator: ran `git show` and `git grep` over origin/main and `idea/continue-and-the-agent-panel-refuse`; read the bridge adapter; ran no tests.

## Decisions

| Decision | Taken by |
|---|---|
| A null pulse stays `no-pulse`; the plan covers only a non-null partial pulse without the branch. | caller |
| Look the branch up in `lastCompletePulseFor` before refusing; refuse `pulse-partial` (404) otherwise; missing completeness reads as complete. | caller |
| The rule runs after the `input.worktree` / `PLOT_RESTART_WORKTREE` fallback; a named test guards it. | caller |
| Board-free commands out of scope; follow-up #3136. | caller |
| One domain rule with five unit cases; seams on both routes and `agentPanel`; the `refusalWord` case and the `continue-control.test.ts` entry are named. | caller |
| `waits:` markers for `feature/restart-refuses-no-pulse` and `feature/continue-refuses-no-pulse`. | caller |
| `worker-log.ts`, `dispatch.ts` and `implement.ts` readers out of scope; follow-up #3137. | caller |
| No retry; the refusal names the reading only. | moderator: a retry starts an agent later against a pulse the person never saw. |
| Rule file `packages/domain/src/rules/pulse-branch.ts`, function `pulseBranchReading`, returns the chosen pulse; the desk shape stays in `packages/fleet`. | moderator: the domain cannot import `PulseBranch` from fleet, and the rule needs only the walk over branch names. |
| A complete live pulse without the branch answers `unknown-branch` even when the last complete pulse lists it. | moderator: the newer finished scan is the better reading; the branch left the plan. |
| `AgentPanelFacts.tsx` gets one sentence per miss reason; the wrong `'unknown-branch'` TSDoc line is corrected. | moderator: the slice touches the union anyway. |

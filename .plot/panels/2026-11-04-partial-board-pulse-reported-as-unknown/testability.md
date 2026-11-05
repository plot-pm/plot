# Testability juror: partial-board-pulse-reported-as-unknown

Position: amend

## Lens

Testability: is every behaviour asserted on a domain property or a script contract without a browser, does each named test fail before the change and pass after, and can the test run without touching the operator's real fleet, launchd or port 7777?

## Findings

1. **The plan names no test.** The plan has no test list. Approach item 3 says "a unit test asserts" the rule, and the slice line names no test file. An unattended agent must choose the files, the cases and the layer. The sibling plan `docs/plans/2026-11-04-restart-refuses-unknown-branch-when-it.md` (Approved, #3114) names each test by file and line; this plan must do the same.
2. **The route seams carry the pulse but not its completeness.** `handleRestart` takes `deps.pulse` (`packages/board/src/server/restart.ts:67`) and `handleContinue` takes `deps.pulse` (`packages/board/src/server/continue.ts:122`). Neither takes a completeness reader. `packages/board/test/unit/restart-route.test.ts:41-58` injects `{ pulse: () => pulse }` with `opts` on port 4399 and `repoRoot: '/nonexistent'`, opens no socket and touches no fleet. A new test can use the same pattern only after the slice adds a `deps.pulseComplete` seam (default `pulseCompleteFor`) to both routes. Without that seam, a route test reaches the real `ensureCache(opts)` and scans. The plan must name the seam.
3. **The agent panel has no seam at all.** `agentPanel(opts, branch, env)` (`packages/board/src/server/agent-panel.ts:156-162`) calls `pulseFor(opts)` directly. Its only route test, `packages/board/test/agent-panel.test.mjs`, starts a built server with a stubbed `plot-fleet-scan.sh`. A partial-pulse case through that file needs a stub that omits the terminal `reading` line (`agent-panel.test.mjs:34-42` explains that shape) and a running server. Approach item 3 says the panel "computes nothing", which is testable only if the panel calls the shared rule and the rule carries the test. The plan must say: the rule's unit test asserts the choice, and the panel gets either an injectable pulse/completeness reader or no new test beyond one that proves it forwards the rule's answer.
4. **The rule has no home.** "One rule" is unplaced. `branchFromPulse` lives in `packages/fleet/src/shared/continue-command.ts:28`; `restartBranch` in `packages/fleet/src/shared/restart-command.ts:114-118`; `continueBranch` at `continue-command.ts:82-91`. The plan must name the function, its file and its signature, so the unit test file is fixed: for example a pure function over `(pulse, complete, branch)` in `packages/domain/src/rules/` with a test in `packages/domain/test/`, or a new input on `restartBranch`/`continueBranch` with tests in `packages/fleet/test/unit/restart-command.test.ts` and `continue-command.test.ts`. Both run with no browser, fleet, launchd or port.
5. **Approach item 4 contradicts the approved sibling plan, and the tests will contradict each other.** #3114 (Approved) makes `restartBranch` answer `no-pulse` for a null pulse with no worktree, and rewrites `packages/fleet/test/unit/restart-command.test.ts:54-57` to assert it. Draft #3129 extends `no-pulse` to continue and the agent panel. This plan says "the rule treats a null pulse as partial". If both land, one test asserts `no-pulse` for `pulse: null` and the other asserts the partial refusal. The plan must say that a null pulse keeps `no-pulse` from #3114, that this rule decides only the non-null partial case, and that the slice waits on `feature/restart-refuses-no-pulse` (a `waits:` marker).
6. **Fail-before is reachable but not stated.** A test that injects a non-null pulse without the branch and `complete: false` gets `unknown-branch` on origin/main (`restart-command.ts:118`) and the new reason after the change. That is the fail-before proof. A test with `complete: true` and the same pulse must keep `unknown-branch`; that one passes before and after and guards the regression. A test with a partial pulse that DOES list the branch must not refuse the partial reason (it reaches `no-worktree` or the restart path). Without that third case, an implementation that refuses on `!complete` before the lookup passes the first two tests and blocks every restart during every scan.
7. **The board typecheck is a test the plan omits.** A new `ContinueRefusal` member (`packages/fleet/src/shared/continuation.ts:99-103`) needs a case in `refusalWord` (`packages/board/src/app/components/ContinueWithAnAnswer.tsx:34-76`, no `default`, `strict: true`), or `pnpm run typecheck` fails. The "distinct sentence" list in `packages/board/test/unit/continue-control.test.ts:57-64` must gain the reason. The panel's own reason union (`agent-panel.ts:64`) must gain it too. The changelog line says "names a partial pulse", which no test asserts until the plan names the detail string.
8. **Open Questions block the assertions.** Questions 1 (name, status 409 or 503) and 3 (retry or name only) change every expected value. Question 2 (the board-free commands) decides whether `packages/fleet/test/unit/restart-command.test.ts` gains an entry-level case. A Sonnet agent cannot settle these; a person must, or the plan states defaults the tests assert.

## Amendments required

- A1. Name the rule's function, file and signature, and its unit test file with the three cases in finding 6 (partial + absent → new reason; complete + absent → `unknown-branch`; partial + listed → not the new reason).
- A2. Add `deps.pulseComplete` to `handleRestart` and `handleContinue`, and name one case each in `restart-route.test.ts` and `continue-route.test.ts` injecting `{ pulse: () => p, pulseComplete: () => false }`.
- A3. State how the agent panel is tested: a reader seam on `agentPanel` with a unit case in `packages/board/test/unit/agent-panel.test.ts`, not a new server test in `agent-panel.test.mjs`.
- A4. Replace approach item 4: a null pulse keeps `no-pulse` per #3114; add `<!-- waits: feature/restart-refuses-no-pulse -->` to the slice and name #3129 as the seam for continue and the panel.
- A5. Name the `refusalWord` case, its sentence, and the `continue-control.test.ts` reason list.
- A6. Settle Open Questions 1-3 or state defaults the tests assert.

## Decisions for a person

- Refusal name and HTTP status (Open Question 1).
- Whether the board-free commands, which read `.plot/state/last-pulse.json` with no completeness field, change at all (Open Question 2).
- Retry versus name only (Open Question 3).
- Whether this plan and Draft #3129 merge into one slice, since both edit the same three call sites and the same union.

## What I ran versus read

Ran: `git show origin/main:` on `restart.ts`, `continue.ts`, `agent-panel.ts`, `fleet.ts:3295-3325`, `restart-command.ts`, `restart-route.test.ts`, `agent-panel.test.ts`, `agent-panel.test.mjs`, the sibling plan and its testability verdict; `git grep` for `pulseFor`, `pulseCompleteFor` and `unknown-branch`; `gh issue view 3118`; `gh pr list` for #3114 and #3129. Read only: everything else. Ran no test suite.

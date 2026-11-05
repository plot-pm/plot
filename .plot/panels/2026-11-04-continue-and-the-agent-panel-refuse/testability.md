# Testability juror — continue and the agent panel refuse

Position: amend

Lens: is every behaviour asserted on a domain property or a script contract without a browser, does each named test fail before the change and pass after, and can the test run without touching the operator's real fleet, launchd or port 7777?

## Findings

1. **The `continueBranch` half is testable as written.** `packages/fleet/test/unit/continue-command.test.ts:42-45` passes `pulse: null` straight into `continueBranch` and asserts `unknown-branch` on origin/main. Rewritten to assert `no-pulse`, it fails on main and passes after. It reaches no fleet, no launchd and no port. The guard at `:37-40` keeps a non-null pulse without the branch on `unknown-branch`.

2. **The `continue-route` half is testable as written.** `packages/board/test/unit/continue-route.test.ts:312-317` injects `pulse` through `ContinueDeps`, and its comment says `wt` of null "is a board whose pulse has never landed". The test at `:744-749` ("refuses a branch the board has never heard of") passes `deps(null)`, so it asserts the no-pulse case under the wrong name today. The rename and the `no-pulse` assertion fail on main and pass after. The `opts.port: 7777` at `:323` is a value in an options object; the test binds nothing.

3. **The agent panel's `no-pulse` answer has no seam a unit test can reach.** `agentPanel(opts, branch, env)` (`packages/board/src/server/agent-panel.ts:156-162`) calls `pulseFor(opts)` itself; `pulseFor` (`packages/board/src/server/fleet.ts:3301-3303`) reads the board's module cache. The only caller is the route at `packages/board/src/server/index.ts:663`. The unit suite `packages/board/test/unit/agent-panel.test.ts` tests `branchFromPulse`, `parseEtime` and `uptimeSeconds` only, never `agentPanel`. The plan puts the new case in `packages/board/test/agent-panel.test.mjs`, which starts a full board server (`startServer`, `helpers.mjs:216`, `PORT=0`, so not 7777) against a stubbed `plot-fleet-scan.sh` that always finishes and a `settle()` that waits for the pulse. The plan does not say how that test produces a cold cache. A request sent before the first scan lands is a race against the server's boot scan, and a stub that never finishes changes what the other cases in the file read. As written, the test is either flaky or unbuildable from the plan alone.

4. **The panel sentence is decided in a `.tsx` component and the plan names no test for it.** `packages/board/src/app/components/AgentPanelFacts.tsx:367-369` picks the sentence with a ternary inside JSX. The slice turns that into a three-way choice. Under the repo rule "every rendered state is a domain property", a choice that only a render can assert is a property not yet extracted. The restart plan's comparable choice, `refusalWord`, is an exported function asserted in `packages/board/test/unit/continue-control.test.ts:58-76` (distinct sentence per reason). This plan has no equivalent for the panel, so nothing fails if `no-pulse` falls through to the `unknown-branch` sentence.

5. **The `continue-control.test.ts` line is not this slice's evidence.** The plan says `no-pulse` "is already in the `reasons` list from the restart slice". Then that test neither fails before nor passes because of this slice. Listing it under "Tests that fail on origin/main and pass after the change" overstates the test plan.

6. **The continue entry has a seam and the plan does not use it.** `ContinueCommandDeps.pulse` (`packages/fleet/src/server/entry/continue-command.ts:35-37`) lets a test pass `pulse: () => null` to `run`. The restart plan adds exactly that entry test for `plot-restart-command.mjs` (its line 81). This plan changes what `plot-continue-command.mjs` prints and names no test for the printed `no-pulse: …` line, which is the script contract the master agent reads.

7. **Order against `unattended` is undecided.** `continueBranch` looks the branch up before `continueOnDesk` checks the caller, so on main an unattended caller with `pulse: null` gets `unknown-branch`, and after the change gets `no-pulse`. The restart plan pins its order with a dedicated test (its line 89). This plan states no order and names no test for it.

8. **Minor: the `AgentPanelMiss` TSDoc on main is wrong for `unknown-branch`.** `agent-panel.ts:63-64` documents `unknown-branch` as "The pulse knows the branch but reports no worktree path for it", which describes `no-worktree`. The slice edits this union and should correct the line.

## Amendments required

1. Give `agentPanel` a pulse seam (for example a fourth parameter `deps: { pulse?: (opts) => FleetReading | null }` defaulting to `pulseFor`), or extract the miss decision into an exported pure function of `(pulse, branch)`. Assert `no-pulse` for a `null` pulse, `unknown-branch` for a non-null pulse without the branch, and `no-worktree` for an entry with an empty worktree in `packages/board/test/unit/agent-panel.test.ts`. Drop the cold-cache case from `agent-panel.test.mjs`, or name the exact mechanism that makes it deterministic.
2. Extract the panel sentence into an exported function (for example `panelMissWord(reason: AgentPanelMiss)`) with no `default` branch, and add a unit test that asserts a distinct sentence for each of the three reasons.
3. Add an entry test in `packages/fleet/test/unit/continue-command.test.ts`: `run(['feature/x', 'yes'], repo, scriptsDir, { pulse: () => null }, write, warn)` returns 1 and `warn` receives `plot-continue-command: no-pulse: no current fleet reading to look the branch up in` (match the entry's real prefix). Use a `mkdtempSync` directory removed by its exact name.
4. State the order of `no-pulse` against `unattended` in `continueBranch`, and add one test that pins it.
5. Assert the `detail` string as well as the `reason` in the rewritten `continue-command.test.ts:42-45` case, as the restart plan does.
6. Move `continue-control.test.ts` out of the "fail before, pass after" list; name it as coverage the restart slice already provides.
7. Correct the `unknown-branch` TSDoc in `AgentPanelMiss`.

## Decisions that need a person

- The two open questions (panel wording, and the HTTP status of `GET /api/agent-panel` for `no-pulse`) decide what the tests assert. A Sonnet agent cannot write the assertions until a person answers them. Close both before approval.

## Ran versus read

Ran: `git show origin/main:` on `continue-command.ts`, `continue-command.test.ts`, `entry/continue-command.ts`, `agent-panel.ts`, `agent-panel.test.mjs`, `test/unit/agent-panel.test.ts`, `continue-route.test.ts`, `continue-control.test.ts`, `AgentPanelFacts.tsx`, `fleet.ts`, `helpers.mjs` and the restart plan; `git grep` for `agentPanel(` callers; `gh pr list` for the restart plan's PR (#3114, merged). Ran no test suite, no board, no fleet command. Fail-before claims are read from the current assertions, not executed.

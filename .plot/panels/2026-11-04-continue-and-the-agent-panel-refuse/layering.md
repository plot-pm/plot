# Layering juror: continue and the agent panel refuse unknown-branch with no pulse

Position: amend

## Summary

The change routes through the existing controllers, reads the bridged pulse and the board cache rather than buying an answer from a host, and adds no shell. It still places the one decision it fixes, "no reading" versus "a reading that does not list the branch", in a third and fourth call site instead of in one rule, and it extends a wording decision that lives in a `.tsx` ternary.

## Findings

1. The plan decides `no-pulse` separately in each caller. `branchFromPulse` (`packages/fleet/src/shared/continue-command.ts:28-45`) returns `null` both for a `null` pulse and for a pulse that does not list the branch. The restart plan tests `input.pulse === null` in `restartBranch` (`restart-command.ts:114-119`). This plan adds the same test to `continueBranch` (`continue-command.ts:82-91`) and to `agentPanel` (`packages/board/src/server/agent-panel.ts:161-162`). That gives three copies of one rule, and #3118 (a partial board pulse) will touch all three again. The rule belongs in the lookup: one function that answers `no-pulse`, `unknown-branch` or the found desk, and that every caller maps to its own reason type.
2. The panel sentence is decided in a component. `AgentPanelFacts.tsx:366-368` picks the sentence with a two-arm ternary on `panel.reason`. CLAUDE.md "Every rendered state is a domain property" rules out wording computed in `.tsx` that only a render can test. The plan adds a third arm there and names no unit test for the sentence. A new `AgentPanelMiss` member would fall into the `else` arm with no type error, which is exactly the defect this plan fixes for `unknown-branch`. `refusalWord` (`ContinueWithAnAnswer.tsx:34`) is the existing precedent: an exported, exhaustive `switch` with a unit test in `packages/board/test/unit/continue-control.test.ts`.
3. The rule lives in `@plot-pm/fleet/shared`, not in `@plot-pm/domain`. `continue-command.ts`, `restart-command.ts` and `ContinueRefusal` (`packages/fleet/src/shared/continuation.ts`) are outside the domain package. That placement predates this plan, and moving it is out of scope. The plan must not add to it beyond the minimum: no new decision in `packages/board/src/server/`.
4. Shell growth: none. The slice edits one row in `skills/plot/scripts/README.md` and no `.sh` file, so `scripts/check-shell-lines.sh` sees no change.
5. Index reading: correct. The CLI reads the bridge file through `fleetStateFile()` (`packages/fleet/src/server/entry/continue-command.ts:4`) and the board reads `pulseFor(opts)`. No host call is added.
6. Controllers: correct. `continue` stays reachable only through `continueBranch`, from both `plot-continue-command.mjs` and `POST /api/continue`.
7. Open question 2 has an answer in the code. `packages/board/src/server/index.ts:663-667` writes 404 for every `panel.ok === false`, whatever the reason. `no-pulse` gets 404 with no route change. The plan can close that question and name the line.

## Required amendments

1. Change `branchFromPulse`, or add a sibling lookup beside it in `continue-command.ts`, so that it returns a three-way answer: `{ kind: 'no-pulse' }`, `{ kind: 'unknown-branch' }` or `{ kind: 'found', desk }`. `continueBranch` and `agentPanel` map that answer to their reason and test nothing about `pulse` themselves. State whether `restartBranch` moves to the same lookup in this slice or stays as the restart plan left it. Moving it is preferred: it is one call site, and the restart slice lands first.
2. Replace the ternary in `AgentPanelFacts.tsx` with an exported, exhaustive `panelMissWord(reason: AgentPanelMiss): string` (a `switch` with no `default`, so `strict` fails on a new member). Add a unit test for its three sentences beside the `refusalWord` test, so that the sentence can be asserted without a browser.
3. Close open question 2 with `index.ts:663-667`: 404, no route change.
4. Settle open question 1 in the plan before approval. An unattended agent cannot choose between two sentences. The panel is a one-line strip, so the plan's own shorter sentence (`No current fleet reading yet — wait for the next fleet scan.`) is adequate; name it as the decision.

## Decisions for a person

- Open question 1, the panel wording. Amendment 4 proposes the plan's own sentence.
- Whether `restartBranch` moves to the shared three-way lookup in this slice (amendment 1).

## What I ran and what I only read

Ran (read-only): `git fetch origin main`; `git show origin/main:` for `continue-command.ts` (both), `restart-command.ts`, `agent-panel.ts`, `AgentPanelFacts.tsx`, `index.ts:655-672`, `test/agent-panel.test.mjs:195-225` and the restart plan; `git grep` for `ContinueRefusal`, `refusalWord` and `AgentPanelMiss`.

Read only: the plan, CLAUDE.md. Not read: issue #3117 through `gh`, and the test files `continue-route.test.ts` and `continue-control.test.ts` beyond the grep hits. I ran no test suite.

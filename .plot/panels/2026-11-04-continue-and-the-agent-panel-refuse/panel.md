# Panel round 1: continue and the agent panel refuse unknown-branch with no pulse

Plan PR #3129, issue #3117. Four jurors: layering, safety, testability, seams. Every verdict names a position, and all four positions are `amend`.

## Positions

| Juror | Position | Core finding |
|---|---|---|
| layering | amend | The `null`-pulse decision lands in three call sites instead of one lookup; the panel sentence is decided in a `.tsx` ternary. |
| safety | amend | Nothing new can start, stop or merge; close the two open questions and state that `agentPanel` returns before any disk or process read. |
| testability | amend | `agentPanel` has no pulse seam, so the cold-cache test races the boot scan; the panel sentence has no unit test; the CLI output and the order against `unattended` have no test. |
| seams | amend | Plan #3127 maps a `null` pulse to a different answer on the same call sites; #3109 moves the cited lines; #3112 edits the README; a reasons list is not named. |

## Disagreements

- **Where the `null`-pulse rule lives.** Layering asks for one three-way lookup that `continueBranch`, `agentPanel` and `restartBranch` map. Safety and testability accept a check per caller and ask only for a three-way choice in the panel and a seam. Seams names the three copies as a hazard for #3127 but asks for no move. Decided (caller): one lookup, shared by all three callers.
- **How to test the cold panel.** The plan put the case in `agent-panel.test.mjs` (a full board server). Testability says that case races the boot scan and asks for a seam and a unit test. Safety asks for the `.mjs` case with `status === 404`. The two asks conflict on where the evidence lives. Decided (caller): a pulse seam on `agentPanel`, a unit test, no cold-cache case in the `.mjs` file.
- **Whether the old panel sentence is wrong.** The plan said `No scan has reported this branch` is correct for `unknown-branch` only. Safety says it is also true for a cold cache, and still prefers a distinct sentence so `data-panel-miss` names a distinct reason. The other jurors do not address the claim. Decided: the plan keeps a distinct sentence; the claim that the old sentence is false for a cold cache is removed from the plan.
- **Who owns the `null` pulse.** Seams finds that #3127's Approach 4 maps a `null` pulse to its partial refusal, which contradicts this plan, and leaves the choice to a person. No other juror read #3127. Decided (caller): this plan owns it; #3127 covers only a non-null partial pulse and waits on this slice.

## Shared blind spots

- No juror ran a test, a typecheck or a build. Every fail-before claim is read from the current assertions, not executed.
- No juror read the restart slice's code: `feature/restart-refuses-no-pulse` is not on origin, so the plan's mapping of `restartBranch` onto the shared lookup builds on the restart plan's text, not on its diff.
- Only seams named #3109's line moves; the other three jurors cite origin/main line numbers that move when #3109 merges.
- No juror checked `packages/board/test/unit/routes-are-thin.test.ts`, which forbids `branchFromPulse` in the thin routes and does not know a new lookup name. The amended plan adds `lookupBranch` to its patterns.

## What each juror ran and what it only read

- **layering**: ran `git show origin/main:` on the source files and the restart plan, and `git grep` for `ContinueRefusal`, `refusalWord`, `AgentPanelMiss`. Did not read issue #3117 or the route and control tests beyond grep hits.
- **safety**: ran `git show` on the source and tests, `git grep` for `unknown-branch`, `no-pulse`, `panel-miss`, `gh issue view 3117`, and `gh pr list` for the restart branch.
- **testability**: ran `git show` on the source, the unit and `.mjs` tests, `helpers.mjs` and the restart plan; `git grep` for `agentPanel(` callers; `gh pr list` for PR #3114.
- **seams**: ran `gh pr diff --name-only` over eight open PRs, `gh pr diff 3109`, `gh pr view 3109`, `git ls-remote` for three slice branches, and `git grep` over the domain package and shell scripts.

## Claims verified by the moderator against origin/main

- `continue-command.ts:28-45` (`branchFromPulse`), `:82-91` (`continueBranch`); `restart-command.ts:114-119`; `agent-panel.ts:60-64`, `:156-162`; `index.ts:663,667` (`panel.ok ? 200 : 404`); `AgentPanelFacts.tsx:366-368`.
- `continue-command.test.ts:42-45` asserts `unknown-branch` for `pulse: null`; `continue-route.test.ts:745-749` uses `deps(null)`; `:847-857` lists five reasons without `no-pulse`.
- The restart plan orders the lookup refusals before `continueOnDesk`'s `unattended` check; `restartBranch` on origin/main confirms that order.
- `routes-are-thin.test.ts:36,43` forbid `branchFromPulse` in `restart.ts` and `continue.ts`.
- No remote ref exists for `feature/restart-refuses-no-pulse`, `feature/continue-refuses-no-pulse` or `feature/partial-pulse-names-itself`. PR #3109 reads `OPEN DIRTY`.

## Decisions

| Decision | By |
|---|---|
| This plan owns the `null` pulse (`no-pulse`); #3127 covers a non-null partial pulse and waits on this slice; this plan does not wait on #3127. | caller |
| `GET /api/agent-panel` keeps 404 for every miss (`index.ts:667`). | caller |
| Panel sentence for `no-pulse`: `No current fleet reading yet — wait for the next fleet scan.` | caller |
| `panelMissWord`, exported and exhaustive, with a unit test per reason; no decision left in `AgentPanelFacts.tsx`. | caller |
| One `lookupBranch` for `continueBranch`, `restartBranch` and `agentPanel`; `restartBranch` moves to it in this slice; the `waits:` on the restart slice stays. | caller |
| `agentPanel` returns on a missing pulse before any disk or process read, and gains a `deps.pulse` seam. | caller |
| The lookup refusals come before `unattended`, as in `restartBranch`. | caller (restart order) |
| `continue-control.test.ts` leaves the fails-before list. | caller |
| `branchFromPulse` stays exported as a wrapper over `lookupBranch`, so its callers and three existing tests keep passing. Reason: smallest diff, reversible. | moderator |
| `lookupBranch` stays in `@plot-pm/fleet/shared`; moving it into the domain is #3139. Reason: the placement predates this plan. | moderator |
| `routes-are-thin.test.ts` adds `lookupBranch` to its patterns. Reason: the thin-route guard must cover the new name, fail-closed. | moderator |
| A route test for `unknown-branch` with a non-null pulse is added. Reason: the route file has no case that separates the two reasons once `deps(null)` answers `no-pulse`. | moderator |
| The `unknown-branch` TSDoc on `AgentPanelMiss` is corrected. Reason: it describes `no-worktree` today (testability finding 8). | moderator |

## Filed

- #3139 — Branch lookup rule outside the domain package (layering finding 3).

## Outside this plan

- The sprint file `docs/sprints/2026-W45-follow-ups-2-30-1.md` on origin/main does not list this plan (seams finding 6). The sprint line belongs with the approval commit.

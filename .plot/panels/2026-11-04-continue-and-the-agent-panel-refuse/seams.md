# Seams juror — continue and the agent panel refuse unknown-branch with no pulse

Position: amend

Lens: where this change meets other plans, open PRs, branches, declared shell/domain duplicates and the corpus tier.

## Findings

### 1. Plan #3127 (issue #3118) edits the same three call sites and gives a null pulse a different answer

- `origin/idea/partial-board-pulse-reported-as-unknown:docs/plans/2026-11-04-partial-board-pulse-reported-as-unknown.md`, Approach 1 and the slice `feature/partial-pulse-names-itself`: restart, the continue route and `agent-panel.ts` pass `pulseCompleteFor` to one new rule that chooses the refusal.
- Approach 4 of that plan: "A cold cache (null pulse) reads `pulseCompleteFor` as `true`; the rule treats a null pulse as partial, not as 'no plan names the branch'." That maps a `null` pulse to the partial-pulse refusal. This plan maps the same input to `no-pulse`. The two plans give one input two answers.
- Both plans carry `Sprint: follow-ups-2-30-1`. Neither carries a `waits:` marker on the other. The fleet can dispatch both slices at once. Both edit `packages/board/src/server/agent-panel.ts:161-162` and the `continueBranch` lookup in `packages/fleet/src/shared/continue-command.ts:82-91`. The result is a textual conflict at best and a semantic conflict at worst: whichever lands second either drops `no-pulse` or re-routes a null pulse.
- This plan names #3118 only as "Not decided here" (`:78`). It names no overlap and no order.

### 2. Open PR #3109 edits three of the files this slice edits, and it is in conflict with main

- `gh pr diff 3109 --name-only` lists `packages/fleet/test/unit/continue-command.test.ts`, `packages/board/test/unit/continue-route.test.ts` and `packages/fleet/src/server/entry/continue-command.ts`.
- #3109 inserts 43 lines (`describe('the author a board answer records', …)`) before `continue-route.test.ts:744`, so the plan's `:744-749` moves to about `:787-792` after it merges.
- #3109 rewrites the module doc block of `entry/continue-command.ts:12-31`, including the line the plan cites at `:21` ("refuses `unknown-branch` and `no-worktree`"), which moves to about `:21-22` inside new text.
- `gh pr view 3109` reads `mergeStateStatus: DIRTY`. The restart slice waits on `bug/an-answer-records-its-true-author`, and this slice waits on the restart slice, so the order holds transitively. The plan does not say so. An agent that reads only this plan and finds the cited lines moved has no instruction.

### 3. Open PR #3112 edits `skills/plot/scripts/README.md`

- `gh pr diff 3112 --name-only` lists the README. This slice edits row `:85`; the restart slice edits row `:86`. Expect a textual rebase on that file. The restart plan names this seam; this plan does not.

### 4. A reasons list the plan does not name

- `packages/board/test/unit/continue-route.test.ts:840-856`, test `gives each refusal its own reason`, lists five `ContinueRefusal` members and no `no-pulse`. Neither this plan nor the restart plan (which names only `continue-control.test.ts:58-65`) adds `no-pulse` there. The test passes either way (it checks only `Set` size), so this is drift, not a failure.

### 5. Shell/domain duplicates and the corpus tier

- `git grep unknown-branch origin/main -- packages/domain skills/plot/scripts/*.sh` finds nothing. No shell script and no domain rule decides this refusal, and no corpus test (`packages/domain/corpus/*.corpus.test.ts`) covers it. The change adds no declared duplicate and no shell lines. No corpus seam follows.
- After the restart slice and this slice, the check "pulse is `null` → `no-pulse`" lives in three TypeScript places: `restartBranch`, `continueBranch` and `agentPanel`. That is not a shell/domain duplicate, but plan #3127 proposes one rule for the same choice. If both plans land as written, #3127's rule must absorb all three copies or it adds a fourth.

### 6. Sprint file

- `docs/sprints/2026-W45-follow-ups-2-30-1.md` on origin/main lists `restart-refuses-unknown-branch-when-it` (`:52`) but not this plan, although the plan carries `Sprint: follow-ups-2-30-1`. The sprint line and its log line belong in the same commit as approval.

### 7. Claims checked and found true

- `continue-command.ts:82-91`, `:28-29`, `agent-panel.ts:60-64` (`AgentPanelMiss`), `:161-162`, `AgentPanelFacts.tsx:367` (the ternary that renders every non-`no-worktree` miss as "No scan has reported this branch"), README `:85`, `continue-command.test.ts:37-44`.
- `continue-route.test.ts:744-749`: `deps(null)` is a `null` pulse (`:312-316`), so the claim holds.
- `agent-panel.test.mjs:211-218`: the same server answers `feature/the-agent-panel` with a full panel at `:197-201`, so its pulse is non-null and the `unknown-branch` cases stay. The plan's "the slice checks that" is satisfied by the fixture.
- `packages/fleet/test/entry-module-graph.test.mjs:106-108` asserts the continue bundle names `unknown-branch`. It still passes after the change.
- No remote branch exists yet for `feature/restart-refuses-no-pulse`, `feature/continue-refuses-no-pulse` or `feature/partial-pulse-names-itself` (`git ls-remote`).

## Amendments required

1. Add a `### Seams with other plans and open pull requests` section that names plan #3127 / issue #3118: both plans edit `agent-panel.ts:161-162` and the `continueBranch` lookup, and #3127's Approach 4 maps a `null` pulse to its partial refusal. State the order: this slice lands first, and `feature/partial-pulse-names-itself` waits on `feature/continue-refuses-no-pulse`. State the invariant #3127 must keep: a `null` pulse answers `no-pulse`; the partial refusal applies only to a non-null, incomplete pulse. Raise the matching amendment on PR #3127 (its Approach 4 and a `waits:` marker).
2. In the same section, name #3109: it edits `continue-command.test.ts`, `continue-route.test.ts` and `entry/continue-command.ts`, it is DIRTY on 2026-11-04, and this slice reaches it through the restart slice's wait. Tell the agent to find the cited tests and doc lines by name after the rebase (`refuses a branch the board has never heard of`, `refuses unknown-branch where there is no pulse at all`, the module doc sentence "refuses `unknown-branch` and `no-worktree`"), not by line number.
3. Name #3112 as a textual seam on `skills/plot/scripts/README.md`: keep both changes on rebase.
4. Add `continue-route.test.ts` `gives each refusal its own reason` (`:840-856`) to the files the slice changes: add `'no-pulse'` to its list and correct the count in its comment.

## Decisions that need a person

- Which plan owns the `null` pulse: this plan (`no-pulse`) or #3127 (partial refusal). The amendments above assume this plan, which matches the approved restart plan. A person confirms it on both plan PRs, because the two Draft plans otherwise reach approval with contradicting designs.
- Open question 2 (status for `no-pulse` on `GET /api/agent-panel`) is already answered by the approved restart plan: 404. A person can close it by reference rather than leave it to the agent.

## What I ran and what I only read

- Ran: `gh pr list`, `gh pr diff --name-only` for #3109, #3127, #3112, #3110, #3105, #3111, #3133, #3135; `gh pr diff 3109` (the three overlapping files); `gh pr view 3109`; `gh issue view 3117`; `git grep unknown-branch origin/main`; `git ls-remote --heads origin` for the three slice branches; `git show` of the source and test lines cited above and of the sprint file.
- Read only: the restart plan on origin/main, plan #3127 on `origin/idea/partial-board-pulse-reported-as-unknown`. No test suite, build, fleet or board command ran.

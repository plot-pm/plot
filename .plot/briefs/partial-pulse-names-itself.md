## Implementation brief — partial-board-pulse-reported-as-unknown (wave 1: Refusal)

- **Plan (canonical):** docs/plans/2026-11-04-partial-board-pulse-reported-as-unknown.md on main
- **Approved:** 2026-11-05, Jan Wloka, plan-PR #3127 merged
- **Branch:** `feature/partial-pulse-names-itself` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** the `plot/review` check on the PR, as every slice PR here (Review: pr)

This slice waits on `feature/restart-refuses-no-pulse` (#3100) and `feature/continue-refuses-no-pulse` (#3117, plan PR #3129 still open at dispatch). Both edit the same refusal arms; this slice moves their inline `no-pulse` arms into one rule. It starts only when both have merged.

### What to build

`POST /api/restart`, `POST /api/continue` and the agent panel refuse `unknown-branch` ("no plan on this board names that branch") for a branch that a PARTIAL board pulse has not reached yet (issue #3118). The refusal states a fact about the plan that the board does not know, and each one counts as an intervention against the sprint goal. Add the domain rule `pulseBranchReading(live, liveComplete, lastComplete, branch)` in `packages/domain/src/rules/pulse-branch.ts` (arrow function, factual TSDoc) with the answer order: `live === null` → `no-pulse`; `live` lists the branch → `listed` (live); incomplete and `lastComplete` lists it → `listed` (lastComplete); incomplete → `pulse-partial`; else `unknown-branch`. Restart, continue and the agent panel call it; the board readers pass `pulseCompleteFor` and `lastCompletePulseFor`, exactly as `deliver.ts:314` does for `deliveryPulse`. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **Null pulse stays `no-pulse`.** #3100 and #3117 define it. Do not turn a cold cache into `pulse-partial`.
- **Look up the last finished scan before refusing.** `pulse-partial` only when `lastCompletePulseFor` does not list the branch either. A stale desk from the last scan is bounded: `continueOnDesk` refuses `no-question` / `no-manifest`, and the restart verdict re-reads the PR and the process table.
- **Absent completeness reads as complete.** `pulseComplete?` absent → `true`, `lastCompletePulse?` absent → `null`. Missing information is never partial. Reason: `pulseCompleteFor` itself reads `true` on a cold cache, and the board-free commands pass nothing.
- **The rule runs AFTER the `input.worktree` fallback in effect.** `restartBranch` with `PLOT_RESTART_WORKTREE` set proceeds with the `elsewhere` desk as today; the rule never adds a refusal where current code proceeds. Test `a named worktree still restarts past a partial pulse` guards this (refuses `unattended`, not `pulse-partial`).
- **404 and no retry.** `pulse-partial` answers 404 like every lookup refusal. The route does not wait for a scan it does not own; a retry would start an agent against a pulse the asker never saw.
- **The rule returns the pulse, `branchFromPulse` builds the desk.** `PulseBranch` stays in `packages/fleet`; the domain imports nothing from it.
- **Out of scope, do not touch:** board-free `plot-restart-command.mjs` / `plot-continue-command.mjs` (`last-pulse.json` has no completeness field; #3136), and `worker-log.ts`, `dispatch.ts`, `implement.ts` (#3137). README rows `skills/plot/scripts/README.md:85-86` stay unchanged.
- **Components decide nothing.** `refusalWord` and `AgentPanelFacts.tsx` only choose wording per reason; no `.tsx` computes which reason applies.
- **Carried rules:** absent is not false (a missing pulse is never "not on the board"); style rule: every function you write is an arrow.

### Done when

The plan's `## Slices` test lists are the specification: the five `pulse-branch.test.ts` cases (a)–(e), the new restart/continue command, route and agent-panel `pulse-partial` tests, and `'pulse-partial'` added to the `reasons` list in `continue-control.test.ts:58-65`. Lift these, because a naive implementation passes without them:

- case (c): a COMPLETE live pulse without the branch → `unknown-branch` even when `lastComplete` lists it. Catches a rule that consults the last scan unconditionally.
- case (d): a partial live pulse that lists the branch → `listed`. Catches a rule that refuses everything while a scan is partial.
- case (e): null live → `no-pulse` for both `liveComplete` values.
- empty `local_worktree` in the last complete pulse → `no-worktree`, not `pulse-partial`. Proves the desk is read from the chosen pulse.
- a non-null pulse, no completeness input → still `unknown-branch` (`restart-command.test.ts:49-52`, `restart-route.test.ts:52-56`). Proves absence reads as complete.

Plus: a changeset `.changeset/<name>.md` (`plot` patch, description first, the plan's Changelog line, no `bumps:` block). Commit no generated bundle (`scripts/check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints, plus the plan's listed checks; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses shell growth under `skills/`; this slice adds no shell, so keep it that way.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/pulse-branch.ts`, `packages/domain/src/index.ts`, `packages/domain/test/pulse-branch.test.ts`, `packages/fleet/src/shared/{restart-command,continue-command,continuation}.ts`, `packages/board/src/server/{restart,continue,agent-panel}.ts`, `ContinueWithAnAnswer.tsx`, `AgentPanelFacts.tsx`, the matching tests, and one changeset. In flight on the same files: #3100's `feature/restart-refuses-no-pulse`, #3117's `feature/continue-refuses-no-pulse`, and #3109's `bug/an-answer-records-its-true-author` (reached through the restart slice's wait). Rebase onto their merges rather than resolving against them early.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

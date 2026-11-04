# Seams juror — partial-board-pulse-reported-as-unknown (plan PR #3127, issue #3118)

Position: amend

## Lens

Seams: where this change meets other plans, open PRs and branches, declared shell/domain duplicates and the corpus tier, and whether the plan names each conflict, drift or ordering constraint.

## Findings

### 1. Approach step 4 contradicts an Approved plan and a sibling Draft (HIGH)

- Approved plan `docs/plans/2026-11-04-restart-refuses-unknown-branch-when-it.md` (issue #3100, slice `feature/restart-refuses-no-pulse`) settles that a `null` pulse with no named worktree refuses `no-pulse` (404, detail `no current fleet reading to look the branch up in`) in `restartBranch`.
- Draft plan PR #3129 (`docs/plans/2026-11-04-continue-and-the-agent-panel-refuse.md`, issue #3117, slice `feature/continue-refuses-no-pulse`) applies the same `no-pulse` answer to `continueBranch` and to `agentPanel` (new `AgentPanelMiss` member).
- This plan, Approach step 4, says "the rule treats a null pulse as partial". That gives the input `pulse === null` a second refusal (`pulse-partial`) in the same three functions. The three plans cannot all ship as written: whichever lands last overwrites the others' null-pulse arm, and the tests each plan names (`restart-command.test.ts:54-57`, `continue-command.test.ts:42-44`, `continue-route.test.ts:744-749`) assert different reasons for one input.
- The plan names neither sibling. "Refs #3100" in Motivation points at the issue, not at the Approved plan that owns the null case, and #3117 / PR #3129 do not appear at all. Both sibling plans name #3118 as out of scope, so the seam is visible from their side only.

### 2. No ordering constraint on the slice (HIGH)

The slice edits the same lines the two sibling slices edit:

- `packages/fleet/src/shared/restart-command.ts:114-119` (`restartBranch` lookup arm) — also `feature/restart-refuses-no-pulse`.
- `packages/fleet/src/shared/continue-command.ts:82-91` (`continueBranch`) — also `feature/continue-refuses-no-pulse`.
- `packages/board/src/server/agent-panel.ts:60-64` (`AgentPanelMiss`) and `:161-162` — also `feature/continue-refuses-no-pulse`.
- `packages/fleet/src/shared/continuation.ts:99-103` (`ContinueRefusal`) and `packages/board/src/app/components/ContinueWithAnAnswer.tsx` `refusalWord` (exhaustive switch, `strict: true`) — also `feature/restart-refuses-no-pulse`, which itself `waits:` on #3109 (`bug/an-answer-records-its-true-author`, OPEN, edits `continuation.ts`, `ContinueWithAnAnswer.tsx`, `continue.ts`, `continue-route.test.ts`, `continue-command.ts`).
- `packages/board/src/app/components/AgentPanelFacts.tsx:367` — also `feature/continue-refuses-no-pulse`.
- `skills/plot/scripts/README.md:85-86` — rows for both command bundles name their refusals; edited by both siblings and by #3112 (OPEN). This plan does not list it.

The branch line `feature/partial-pulse-names-itself` carries no `waits:` marker. A fleet that dispatches it in parallel with the two siblings produces three PRs that conflict on the same arms and a fourth (#3109) underneath. That is an intervention the sprint goal forbids.

### 3. Open question 1 is already settled by the sibling (MEDIUM)

The restart plan fixes the vocabulary this plan asks about: lookup refusals are 404, a new reason joins `ContinueRefusal` with a TSDoc line, and `refusalWord` gains a sentence. The panel uses its own `AgentPanelMiss` union (`agent-panel.ts:60-64`), separate from `ContinueRefusal`. The plan leaves 409/503 and "new member or detail" open; an unattended Sonnet agent would choose, and a choice of 503 or a detail field diverges from the sibling convention.

### 4. "One rule" has no named home (MEDIUM)

Approach step 3 calls the choice "a domain property" in "one rule" but names no file. `branchFromPulse` lives in `packages/fleet/src/shared/continue-command.ts:28-29`, which `agent-panel.ts` re-exports; it is not under `packages/domain/src/rules/`. The siblings extend that same function's callers. The plan must say where the rule lives (a `packages/domain/src/rules/` file with an arrow export, or beside `branchFromPulse` in the fleet shared module) so the three slices converge on one function instead of three inline `if`s.

### 5. The board-free commands and the bridge (MEDIUM, decision)

`plot-restart-command.mjs` and `plot-continue-command.mjs` read `.plot/state/last-pulse.json` through `parseBridge` (`packages/domain/src/adapters/fleet-state/fleet-state-file.ts`); the bridge carries `version`, a timestamp and `pulse`, and no completeness field. Open question 2 is real: either the bridge gains a field (a `BRIDGE_VERSION` bump, which makes every older reader answer `null` and therefore `no-pulse` under the sibling plan), or the CLI stays out of scope and keeps `unknown-branch` for a partial bridged pulse. The plan must decide, and say so in Changelog and Approach. The README rows `:85-86` follow from that decision.

### 6. Shell duplicates and corpus tier (no finding)

- `git grep unknown-branch` over `skills`, `test` and `packages/domain/corpus` on origin/main finds only README rows `:85-86`; no shell script branches on the reason. `plot-dispatch.sh --restart` exits 1 on any failure (per the restart plan, `:1841`).
- No corpus pair covers the restart/continue lookup, so no declared duplicate drifts. `scripts/check-shell-lines.sh` is unaffected if the slice adds no shell.
- The delivery gate's precedent (`deliver.ts:314`, `deliveryPulse(meta, pulseFor(opts), pulseCompleteFor(opts), lastCompletePulseFor(opts))`) is a correct citation; `pulseCompleteFor` is `true` on a cold cache (`fleet.ts:3316-3319`), which the plan's step 4 states correctly.

### 7. Other open PRs (no conflict)

#3105, #3110, #3111, #3128, #3130–#3133 touch no file this slice names. #3112 touches `skills/plot/scripts/README.md` only on rows other than `:85-86` (textual rebase at most).

## Required amendments

1. Replace Approach step 4: a `null` pulse answers `no-pulse` as the Approved restart plan and PR #3129 settle it; `pulse-partial` applies only to a non-null pulse with `pulseCompleteFor === false` that does not list the branch. A complete non-null pulse keeps `unknown-branch`. State the order: `null` → `no-pulse`; partial and unlisted → `pulse-partial`; complete and unlisted → `unknown-branch`; listed without worktree → `no-worktree`; and for restart, a named `input.worktree` skips the first three.
2. Add a `## Seams` subsection naming plan `2026-11-04-restart-refuses-unknown-branch-when-it` (#3100), PR #3129 (#3117), #3109 and #3112, with the files each shares.
3. Add `<!-- waits: feature/continue-refuses-no-pulse -->` to the slice line (that slice already waits on `feature/restart-refuses-no-pulse`, which waits on #3109's branch).
4. Close open question 1 by adopting the sibling convention: `pulse-partial` joins `ContinueRefusal` (404) with a TSDoc line and a `refusalWord` sentence, and joins `AgentPanelMiss` with an `AgentPanelFacts.tsx` sentence.
5. Name the file and export of the rule (step 3), and list every file the slice changes, including `continuation.ts`, `ContinueWithAnAnswer.tsx`, `AgentPanelFacts.tsx`, `continue.ts` and README `:85-86`.
6. Decide open question 2 (see below) and open question 3 (name the reading only; a retry inside a request handler waits on a scan the route does not own).

## Decisions for a person

- Whether the bridge file gains a completeness field (with a `BRIDGE_VERSION` bump and its effect on older readers) or the board-free commands stay out of scope for #3118. This changes a persisted format that fleetd writes and two bundles read.
- Whether #3117 and #3118 merge into one plan, since both slices change the same three lookup arms and the same two unions.

## What I ran versus read

Ran: `gh pr list`, `gh pr diff 3129`, `gh pr diff --name-only` for #3105, #3109, #3112, `gh pr view --json state` for #3109 and #3112, `gh issue view 3118`, `git show origin/main:` for the restart plan, `restart-command.ts`, `agent-panel.ts`, `fleet.ts`, `fleet-state-file.ts`, and `git grep` for `pulseFor`, `pulseCompleteFor` and `unknown-branch` on origin/main.
Read only: the plan file, the sibling plan in PR #3129. I did not check whether fleetd ever writes a partial pulse to the bridge, and I ran no test.

## Implementation brief — fleet-state-is-read-whole-and-from-one-home (slice 7: Domain pulse lookup)

- **Plan (canonical):** `docs/plans/2026-11-21-fleet-state-is-read-whole-and-from-one-home.md` on `main` — read "Slice 7, the lookup moves into the domain (#3136)"
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3609 merged
- **Branch:** `bug/the-pulse-lookup-moves-into-the-domain` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Slices run in heading order. This slice follows "Partial-pulse readers" (#3677, merged: `pulsePlanReading`, `startReadingFromPulses` and the worker log's `pulseBranchReading` read are on `main`). "New main failure" follows this slice and touches the repair rules only, so no file is shared.

### What to build

The walk "plan → slice → branch" over a fleet reading exists twice. `lookupBranch` and `branchFromPulse` (plus the `PulseBranch` and `BranchLookup` types) live in `packages/fleet/src/shared/continue-command.ts:10-70`. `worktreeForBranch` in `packages/board/src/server/worker-log.ts:117` repeats the same three nested loops and returns only `local_worktree`. A fix to one copy leaves the other wrong, which is how #3136's partial-pulse reads went wrong in three places. This slice changes no behaviour: it leaves one walk, in the domain.

- Move `lookupBranch`, `branchFromPulse`, `PulseBranch` and `BranchLookup` to `packages/domain/src/rules/pulse-branch.ts`, next to `pulseBranchReading` and `pulsePlanReading`. `packages/domain/src/index.ts:687` already re-exports that file.
- Move the `ContinueRefusal` union from `packages/fleet/src/shared/continuation.ts:105` to `packages/domain/src/entities/` (a new file, exported from `index.ts`). Keep every member and its doc comment.
- `worktreeForBranch` becomes a mapper: `lookupBranch(...)` found → `desk.worktree`, with `''` mapped to `null` (the old loop skipped a branch whose `local_worktree` was empty; keep that).
- `packages/board/src/server/agent-panel.ts:70-71` imports `branchFromPulse` from `@plot-pm/domain` and keeps the `export { branchFromPulse }` line, because `agent-panel.test.ts:10` imports it from there.
- Every importer of `ContinueRefusal` from `@plot-pm/fleet/shared/continuation` moves to `@plot-pm/domain`: `RestartTheWorker.tsx`, `ContinueWithAnAnswer.tsx`, `board/src/server/continue.ts`, `restart.ts`, `fleet/src/shared/restart-command.ts`, `origin-desk.ts`, `continuation.ts` itself, and the two board tests. Run `pnpm run typecheck` and the fleet typecheck; `tsc` names the rest.
- `continueBranch`, `restartBranch`, `refusal` and `REFUSAL_DETAIL` stay in `packages/fleet/src/shared/continue-command.ts`. They build a `DeskContinuation`, which is a fleet type, and they call ports.

### Settled decisions — do not re-derive them

**`continueBranch` and `restartBranch` do not move.** The domain takes readings as values and never imports a port or awaits anything (CLAUDE.md, "A note on shape"). Both functions start a process through a port, so they stay in `@plot-pm/fleet/shared`. Only the pure lookup crosses.

**`bridge` and `complete` stay as they are.** The fleet-state file keeps `BRIDGE_VERSION` 1 with no `complete` field (operator decision, 2026-11-21). This slice reads no bridge.

**No behaviour change, and no new arm.** `lookupBranch` answers `no-pulse`, `unknown-branch` or `found`; `pulseBranchReading` is the partial-aware layer above it. Do not fold the two. `pulse-partial` stays decided by `pulseBranchReading` with its four answers in their order.

**Arrow functions.** Everything written or rewritten is `export const f = (…) => …`. The moved bodies already are. `worktreeForBranch` is a `function` declaration today and the body is rewritten, so it becomes an arrow. Leave its 60 neighbours in `worker-log.ts` alone.

**TSDoc is factual API documentation.** Carry the existing blocks over; do not add history. The long comment above `worktreeForBranch` argues why a lookup beats a validator — keep that argument on the mapper, since it is the reason `../` in a branch name never reaches a path.

**Absent is not false.** A `null` pulse is `no-pulse`, not "branch unknown". A found branch with an empty `local_worktree` is still `found`; only `worktreeForBranch` reads it as `null`.

### Done when

The plan's `## Done when` list and Slice 7's **Tests** bullet are the specification. Lifted from them, with what each catches:

- `packages/domain/test/pulse-branch.test.ts` gains `lookupBranch` cells: `null` pulse; unknown branch; a found branch with each of `local_worktree`, `worker` and `worker_pid` absent (the defaults `''`, `'elsewhere'`, `''`); a branch in the second wave of the second plan. Write them first, against the fleet copy, and see them green there before moving the code. A cell that only goes green after the move proves the move changed behaviour.
- `packages/board/test/unit/pulse-lookup-in-domain.test.ts` (new): no file under `packages/board/src` imports `@plot-pm/fleet/shared/continue-command`, and no file under `packages/fleet/src` declares `lookupBranch` or `ContinueRefusal`. It must fail on `main` today. It catches a half-move that leaves a second copy behind and a re-export that hides it.
- `packages/board/test/unit/worker-log.test.ts` (`worktreeForBranch` cells at lines 80-121, including the traversal-string cell) passes unchanged. It catches a mapper that returns `''` instead of `null`.
- `packages/fleet/test/unit/continue-command.test.ts` and `restart-command.test.ts` pass with cells unchanged. The first imports `lookupBranch` and `branchFromPulse` from the fleet module (line 12); that one import line moves to `@plot-pm/domain`, and no cell changes. The plan says no `lookupBranch` tests exist today; that is stale — the fleet file has them at lines 64-84, so move or copy them rather than writing a second set that disagrees.
- `routes-are-thin.test.ts` passes: `continue.ts` still imports `@plot-pm/fleet/shared/continue-command` for `continueBranch`, so the new import test's board rule must name `lookupBranch`/`branchFromPulse` imports and not forbid that module outright for `continue.ts`. Read both tests before writing the assertion, because they must agree.

Plus: no changeset is needed unless a shipped bundle's behaviour changes — this slice changes none, but `scripts/check-no-bundle-diff.sh` refuses a committed `board-server.mjs`/bundle, so do not commit a rebuild. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI and a failure there comes back as a correction; list no full suite and do not run `test:e2e` locally. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns: `packages/domain/src/rules/pulse-branch.ts`, a new `packages/domain/src/entities/` file for `ContinueRefusal`, `packages/domain/src/index.ts`, `packages/fleet/src/shared/continue-command.ts`, `continuation.ts`, `restart-command.ts`, `origin-desk.ts`, `packages/board/src/server/worker-log.ts`, `agent-panel.ts`, `continue.ts`, `restart.ts`, the two `.tsx` components that import `ContinueRefusal`, and the tests named above.

In flight at dispatch (open PRs on `origin`): #3684 (Jenkins refusal), #3683, #3682 (bb ledger), #3681 (`plot-approve`), #3680 and the docs/idea PRs — none names these files. The next slice, `bug/a-new-failure-on-main-starts-a-repair`, holds `repair.ts`, `repair-record.ts` and `default-branch-refresh.ts`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

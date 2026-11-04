# restart refuses unknown-branch when it has no current pulse

> `plot-restart-command.mjs` answers `no-pulse` when the fleet has written no current reading, and keeps `unknown-branch` for a reading that does not list the branch.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #3100
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-restart-command.mjs` refuses `no-pulse` when the fleet has written no current reading, instead of `unknown-branch: no plan on this board names that branch`.

Board impact: none. The plan format, the template, the helper scripts and the `docs/plans` layout do not change.

## Motivation

`restartBranch` (`packages/fleet/src/shared/restart-command.ts:115-118`) refuses `unknown-branch` with the detail `no plan on this board names that branch` in two different cases:

- The pulse lists no such branch.
- No pulse exists to read.

The second case arises in `bridgedPulse` (`packages/fleet/src/server/entry/restart-command.ts:49-52`), which returns `null` when `fleetStateFile().readSync()` answers no value. `parseBridge` (`packages/domain/src/adapters/fleet-state/fleet-state-file.ts:73-93`) returns `null` for a foreign version, a non-finite timestamp, an age below 0 or above `BRIDGE_MAX_AGE_MS` (15 min), and a pulse that fails `FleetReadingSchema`. `readSync` returns `null` for a missing or unreadable file. `branchFromPulse(null, branch)` then returns `null` (`packages/fleet/src/shared/continue-command.ts:29`).

The detail blames the plan. The cause is the bridge. Issue #3092 reports `unknown-branch` on the spike of a Design plan that names the branch; nobody reproduced that run. `assemblePlanWalk` keeps Design plans in the pulse (`packages/domain/src/workflows/plan-walk-assembly.ts:19`, `:302-303`) and `branchFromPulse` has no phase filter, so a missing or stale bridge is the code path that produces that refusal for a branch a plan names. A reader looks for a defect in the plan and finds none.

## Design

### Approach

Add a refusal reason `no-pulse`, with the detail `the fleet has written no current reading`, for the case where `input.pulse` is `null`. `unknown-branch` stays for a non-null pulse that does not list the branch.

- `restartBranch` checks `input.pulse === null` before `branchFromPulse`. `PLOT_RESTART_WORKTREE` still lets a caller name a worktree with no pulse, so the `no-pulse` refusal applies only when `input.worktree` is empty too. The order is: no pulse and no worktree → `no-pulse`; pulse lists no branch and no worktree → `unknown-branch`; no worktree → `no-worktree`.
- The status code stays 404 for both, unless the plan's interrogation decides otherwise (see Open Questions).
- Scope is the refusal wording and reason only. `restart` stays a controller for a claimed slice whose worker died. A never-started slice has no worktree, so a correct lookup still answers `no-worktree` for it (`restart-command.ts:120-122`).

A unit test injects `pulse: () => null` and asserts the reason `no-pulse` and its detail. A second test keeps `unknown-branch` for a non-null pulse that omits the branch.

### Open Questions

- [ ] Does `plot-continue-command.mjs` share the defect? It also calls `branchFromPulse`, so it likely refuses `unknown-branch` for the same missing bridge. This plan changes `restart` only, as the issue scopes it; decide whether `continue` gets its own slice or a follow-up issue.
- [ ] Is 404 the right status for `no-pulse`, or is 503 (the reading is unavailable) more accurate for callers that read the status?
- [ ] Does any caller or doc match on the string `unknown-branch` from restart (board UI, `plot-dispatch.sh --restart`, skill text)? Search before renaming any detail.

## Slices

### Restart names a missing pulse

- `feature/restart-refuses-no-pulse` — `restartBranch` refuses `no-pulse` when the pulse is `null` and no worktree is named; unit tests for `no-pulse` and `unknown-branch`.

## Notes

- Source: issue #3100, found by the panel on plan PR #3095 (`.plot/panels/2026-11-03-registry-never-hands-out-an-approved/`).
- The slice branch builds no new deliverable, so it carries no `builds:` annotation. The deliverable search for `no-pulse refusal` found no existing artifact by that name.

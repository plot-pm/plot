# continue and the agent panel refuse unknown-branch with no pulse

> `continueBranch` and `agentPanel` answer `no-pulse` when they have no fleet reading, and keep `unknown-branch` for a reading that does not list the branch.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3117
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-continue-command.mjs` and `POST /api/continue` refuse `no-pulse: no current fleet reading to look the branch up in` when they have no fleet reading, instead of `unknown-branch: no plan on this board names that branch`. The board's agent panel reports the same `no-pulse` miss.

Board impact: the board changes. `POST /api/continue` and `GET /api/agent-panel` read `pulseFor(opts)`, which is `null` on a cold board cache (`packages/board/src/server/fleet.ts:3301-3303`). The plan format, the template, the helper scripts and the `docs/plans` layout do not change.

## Motivation

Two callers refuse `unknown-branch` when they have no pulse to read, and the detail blames the plan. The cause is the missing reading.

- `continueBranch` (`packages/fleet/src/shared/continue-command.ts:82-91`) calls `branchFromPulse(input.pulse, input.branch)` and refuses `unknown-branch` with `no plan on this board names that branch` when the answer is `null`.
- `branchFromPulse` (`continue-command.ts:28-29`) returns `null` for a `null` pulse. `plot-continue-command.mjs` passes the bridged pulse, which is `null` for a missing, stale, foreign-version or unparseable bridge file.
- `agentPanel` (`packages/board/src/server/agent-panel.ts:161-162`) answers `reason: 'unknown-branch'` for `pulseFor(opts)` = `null`, a cold board cache.
- `packages/fleet/test/unit/continue-command.test.ts:42-44` asserts `unknown-branch` for `pulse: null`.

Plan `2026-11-04-restart-refuses-unknown-branch-when-it` (issue #3100) fixes the same defect for `restart` and adds `no-pulse` to `ContinueRefusal`. This plan applies that reason to the two remaining callers.

## Design

### Approach

Apply the `no-pulse` reason, its detail and its board sentence exactly as the restart plan settles them. This plan does not redefine them.

- `continueBranch`: pulse `null` → `no-pulse` (404, detail `no current fleet reading to look the branch up in`). A non-null pulse that does not list the branch keeps `unknown-branch`. A found entry with no worktree keeps `no-worktree`.
- `continueBranch` takes no `worktree` override (unlike `restartBranch`), so the check is `input.pulse === null` alone.
- `agentPanel`: `AgentPanelMiss` (`agent-panel.ts:60-64`) gains `'no-pulse'`, answered when `pulseFor(opts)` is `null`. This union is separate from `ContinueRefusal`, so the restart plan's slice does not add it.
- `AgentPanelFacts.tsx:367` renders any non-`no-worktree` miss as `No scan has reported this branch`. With `no-pulse` that sentence stays correct for `unknown-branch` only, so the slice adds a `no-pulse` sentence: `No current fleet reading yet — wait for the next fleet scan.` (open question below).
- The TSDoc of `continueBranch` (`continue-command.ts:73-81`) and the module doc of `packages/fleet/src/server/entry/continue-command.ts:21` name `no-pulse`.
- `skills/plot/scripts/README.md` row `board/plot-continue-command.mjs` (`:85`) names `no-pulse` beside `unknown-branch` and `no-worktree`.

### Open Questions

- [ ] Agent panel wording: reuse the restart plan's `refusalWord` sentence, or a shorter panel line? The panel is a one-line status strip, not a refusal message.
- [ ] `GET /api/agent-panel` for a `null` pulse returns 404 today for `unknown-branch`. Does `no-pulse` keep 404, as the restart plan chose for its refusals?

## Slices

### Continue and the panel name a missing pulse

- `feature/continue-refuses-no-pulse` <!-- waits: feature/restart-refuses-no-pulse --> — `continueBranch` refuses `no-pulse` for a `null` pulse; `agentPanel` answers `no-pulse`; the panel strip and docs follow.

Files the slice changes:

- `packages/fleet/src/shared/continue-command.ts` — `no-pulse` branch in `continueBranch`, TSDoc.
- `packages/fleet/src/server/entry/continue-command.ts` — module doc at `:21`.
- `packages/board/src/server/agent-panel.ts` — `AgentPanelMiss` and the `null`-pulse answer.
- `packages/board/src/app/components/AgentPanelFacts.tsx` — sentence for `no-pulse`.
- `skills/plot/scripts/README.md` — row `:85`.

Tests that fail on origin/main and pass after the change:

- `packages/fleet/test/unit/continue-command.test.ts:42-44` — assert `no-pulse` for `pulse: null`.
- `packages/board/test/unit/continue-route.test.ts:744-749` — `deps(null)` is a `null` pulse and now refuses `no-pulse`; rename the test and assert it.
- `packages/board/test/agent-panel.test.mjs` — add a case for a cold pulse answering `no-pulse`. The cases at `:211-218` keep `unknown-branch` only if their fixture supplies a non-null pulse; the slice checks that.
- `packages/board/test/unit/continue-control.test.ts` — `no-pulse` is already in the `reasons` list from the restart slice.

Test that guards the order: a non-null pulse without the branch still refuses `unknown-branch` (`continue-command.test.ts:37-40`).

The slice adds a changeset for `plot` (patch). It commits no generated bundle.

## Notes

- Source: issue #3117 (refs #3100). Order: the slice waits on `feature/restart-refuses-no-pulse` from the restart plan, which adds `no-pulse` to `ContinueRefusal` and to the board's `refusalWord`.
- The deliverable search for `no-pulse refusal` found no existing artifact. The slice builds no new deliverable, so it carries no `builds:` annotation.
- Not decided here: #3118 (a partial board pulse reads as `unknown-branch`).

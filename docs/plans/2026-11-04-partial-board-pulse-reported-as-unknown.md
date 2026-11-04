# Partial board pulse reported as unknown-branch

> A restart, a continue and the agent panel refuse `unknown-branch` for a branch that a partial pulse has not reached yet; they should name the partial reading instead.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3118
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches

## Changelog

`POST /api/restart`, `POST /api/continue` and the agent panel name a partial pulse as the reason when the pulse does not list the branch, instead of refusing `unknown-branch: no plan on this board names that branch`.

<!-- Board impact: changes board server routes and the refusal vocabulary of the continue/restart commands. No change to the plan format, the template or the helper scripts. -->

## Motivation

`POST /api/restart` refuses `unknown-branch: no plan on this board names that branch` for a branch that a partial board pulse does not list yet. The plan may name the branch. The scan did not reach that plan. The refusal states a fact about the plan that the board does not know.

Evidence on origin/main (issue #3118):

- `handleRestart` (`packages/board/src/server/restart.ts:64-68`) passes `pulseFor(opts)` to `restartBranch` and does not read `pulseCompleteFor`.
- `pulseFor` (`packages/board/src/server/fleet.ts:3301-3303`) returns the cached pulse, which can hold only the plans that arrived before the scan was cut short.
- `fleet.ts:3305-3322` documents that completeness lives beside the pulse, and that "a plan absent from a PARTIAL pulse has not been reached".
- `restartBranch` (`packages/fleet/src/shared/restart-command.ts:115-118`) cannot tell a partial pulse from a complete one, so it refuses `unknown-branch` for both.

The delivery gate already separates the two readings (`deliver.ts:314` passes `pulseCompleteFor(opts)` to `deliveryPulse`); the restart, continue and agent-panel readers do not. Refs #3100, and `2026-08-27-a-partial-pulse-does-not-say-not-merged` for the same defect in the Deliver gate.

## Design

### Approach

1. The readers that call `pulseFor` for a branch lookup also read `pulseCompleteFor` and hand both to the command: `restart.ts`, the continue route, and `agent-panel.ts`.
2. `restartBranch` and the continue command take the completeness as an input. When the pulse is partial and does not list the branch, they refuse with a new reason that names the partial reading (for example `pulse-partial`: "the board's scan has not finished; this branch may be named by a plan it has not reached yet"). A complete pulse that does not list the branch keeps `unknown-branch`.
3. The decision "which refusal" is a domain property, so it lives in one rule that a unit test asserts without a browser (CLAUDE.md, *Every rendered state is a domain property*). The agent panel renders the rule's answer and computes nothing.
4. A cold cache (null pulse) reads `pulseCompleteFor` as `true`; the rule treats a null pulse as partial, not as "no plan names the branch".

### Open Questions

- [ ] Name and HTTP status of the new refusal: 409 or 503, and whether it is a new `ContinueRefusal` member or a detail on an existing one.
- [ ] Does `plot-restart-command.mjs` and `plot-continue-command.mjs` (no board, pulse read from `.plot/state/last-pulse.json`) need the same refusal? That file carries no completeness today.
- [ ] Should the refusal retry once after the scan completes, or only name the reading?

## Slices

### Refusal

- `feature/partial-pulse-names-itself` — a rule that chooses between `unknown-branch` and the partial-pulse refusal; restart, continue and the agent panel pass `pulseCompleteFor` to it <!-- builds: the partial-pulse refusal for restart and continue -->

## Notes

Created from tracker issue #3118 by `/plot-idea`, unattended; stopped at Draft. The plan answers the issue and writes nothing to the tracker.

# Two test teardowns turn main red with every assertion passing

> Two tests leaked a process past their own teardown on `main` on 2026-11-01 — every assertion passed, and the leak alone failed CI.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #3006
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches
- **Rounds:** <!-- optional, how many rounds of interrogation this plan has had. Written by /challenge-the-plan, and by hand for an interrogation run without it — the board shows a rounds badge from this field. Absent means nobody has questioned the plan; `0` says it was questioned and nothing came of it, so leave the line out rather than writing zero -->
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- Fix two independent test teardowns that leaked a process and turned `main` red while every assertion passed.

Board impact: none — no change to the plan format, template, helper scripts, or `docs/plans` layout.

## Motivation

Two tests failed CI on `main` on 2026-11-01 while every assertion in each passed. Each made `main` red, and a red `main` refuses every merge through `plot-ask.mjs merge` until a later commit reads green — so a passing-assertions failure still blocks the whole fleet.

1. `owned-run.sh` failed the board-integration job on `56bc1ee12` (run 41322195284) and on `c1113a5b7` (run 41323069974), each leaving one `plot-plan-store-ref-*` entry in the run's `TMPDIR`. `parseBlobs` in `packages/domain/src/adapters/plan-store/plan-store-ref.ts:113` creates the directory and removes it in a `finally`; the directory survives when the process ends while the parser spawn is still pending, so the `finally` never runs. The callers are `fleet.ts` and `entry/scan-walk.ts`; the leaking test is not yet named. The next commit, `fd0eafe14`, ran green with no change to this code — the leak is a race, not a deterministic failure.
2. `continuation.test.ts`'s `afterEach` (`packages/fleet/test/unit/continuation.test.ts`, case *continueOnDesk accepts a fleetd caller* › *proceeds past the refusal "unattended" would hit*) calls `rmSync(desk, { recursive: true, force: true })`, which threw `ENOTEMPTY` because a process the test started was still writing into the desk while it was removed.

## Design

### Approach

Both fixes are the same shape: a test's teardown must wait for the process it started to exit before removing the directory that process writes into. Neither needs a design decision — the existing `rmTree`/wait patterns in this codebase (see the already-released `docs/plans/2026-09-01-a-teardown-does-not-fail-a-suite.md`) are the precedent, not a new mechanism.

### Open Questions

- [ ] The leaking test for slice 1 is not yet named — identifying it is part of that slice's work, not a precondition for approving this plan.

## Slices

### Implementation

- `bug/the-ref-plan-store-waits-for-its-parser` — a test that reaches the ref plan store waits for every spawn it starts before its teardown removes the `plot-plan-store-ref-*` staging directory, so no such entry outlives a run <!-- builds: a spawn-aware teardown for plan-store-ref.ts tests -->
- `bug/the-continuation-test-waits-for-its-agent` — the fleetd continuation test (`continuation.test.ts`) waits for the agent process it starts to exit before its `afterEach` removes the desk, so `rmSync` never races a still-writing process <!-- builds: a process-exit wait in continuation.test.ts's afterEach -->

## Notes

Filed from tracker issue #3006. This plan stops at Draft — whether this is worth doing, and any further design, is the next reader's decision.

# A Draft slice waits on its approval

> A slice of a Draft plan that waits on another slice renders in NOT STARTED, under *approved — nobody has taken it*. The phase check covers only the `deferred` and `open` arms of `classifyGroup`; the `blocked`, `waiting` and `unknown` arms never read the phase. One domain rule answers a Draft plan's branch for every state.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #1161
- **Sprint:** the-fleet-runs-through-its-limits
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A slice of a Draft plan renders in WAITING ON YOU with the note `plan not approved yet — still in review`, whatever its branch state: `blocked`, `waiting`, `unknown`, `open` or `deferred`. A deferred branch with a written reason keeps its QUIET placement, and a live worker still puts the row in WORKING.
- The board payload no longer pairs `verdict: unapproved` with `group: not-started`.

Board impact: one placement rule and one call site in `classifyGroup`. No plan-format, template or script change.

## Motivation

#1161, measured 2026-10-02 on `localhost:7777`: 15 rows rendered in NOT STARTED under *approved — nobody has taken it*, each with the note `waits for <branch>, which has no pull request`. Every one of the 15 carried `verdict: unapproved` and `startability: waiting-on-approval` in the same payload that set `group: not-started`. Example: `an-assignment-is-read-where-it-is-recorded` / `bug/the-queue-reads-the-assignment`, Draft.

**Where the two rules miss each other.** Measured on `origin/main` (`deb439b3`), 2026-10-02, in `packages/board/src/server/fleet.ts`:

- `classifyGroup` starts at `:4096`. Its `planPhase` parameter (`:4119-4130`) is documented as used *"to stop a DRAFT plan's branches reading `eligible`"*.
- The `deferred` arm (`:4397`) answers a Draft plan at `:4446-4472`: QUIET with the written reason (`:4455-4457`), otherwise `{ group: 'waiting-on-you', note: DRAFT_PLAN_NOTE }` (`:4471`).
- The `open` arm (`:4593`) answers a Draft plan at `:4734-4745` with the same result (`:4744`), below the worktree check.
- The worker block (`:4834`, `running` at `:4858`) answers any non-merged branch with a live worker.
- The no-work arms (`:5108-5134`), added by `a-slice-nobody-worked-on-reads-not-started` (released in v2.22.0), return `group: 'not-started'` for `blocked` (`:5124`), `waiting` (`:5127`) and `unknown` (`:5130`). None of them reads `planPhase`.
- `DRAFT_PLAN_NOTE` is `'plan not approved yet — still in review'` (`packages/board/src/contract/schema.ts:1588`).

A slice with a `waits:` annotation reads `blocked` until its prerequisite has a PR. So every later slice of a Draft plan reaches `:5124`. The defect became visible on 2026-10-01, when most new Draft plans declared `waits:`.

**The verdict already says it.** `sliceVerdict` returns `unapproved` for a plan whose phase is not `approved` (`packages/domain/src/rules/eligible.ts:107`), and `startability` returns `waiting-on-approval` for a Draft plan (`packages/domain/src/rules/verdict.ts:60`). Only the placement disagrees.

## Design

### A rule places a Draft plan's branch

A new pure rule in `packages/domain/src/rules/draft-placement.ts`, written as an arrow function:

```ts
export interface DraftPlacementReadings {
  readonly planPhase: string;       // PlanSchema.phase, verbatim; '' when the scan did not say
  readonly state: BranchState;      // the branch's state from the pulse
  readonly deferredReason: string;  // the written reason on a deferred branch, '' when none
}

export type DraftPlacement =
  | { readonly group: 'waiting-on-you'; readonly note: 'draft' }
  | { readonly group: 'quiet'; readonly note: string }
  | null;

/** Where a Draft plan's branch belongs, or null when the phase does not decide. */
export const draftPlacement = (readings: DraftPlacementReadings): DraftPlacement => …
```

| Readings | Answer |
|---|---|
| `planPhase` is not `draft` | `null`: the caller's state arms decide, unchanged |
| `draft`, `deferred`, reason written | `{ group: 'quiet', note: <reason> }` |
| `draft`, `deferred`, no reason | `{ group: 'waiting-on-you', note: 'draft' }` |
| `draft`, `open`, `blocked`, `waiting` or `unknown` | `{ group: 'waiting-on-you', note: 'draft' }` |
| `draft`, `claimed`, `wip` or `merged` | `null`: these arms read commits, a PR or a claim, and #1161 does not change them |

The rule returns the token `'draft'` and not the sentence, because `DRAFT_PLAN_NOTE` lives in the board's contract (`schema.ts:1588`). `classifyGroup` maps the token to `DRAFT_PLAN_NOTE`.

### classifyGroup asks the rule before the state arms

- **The no-work arms.** `classifyGroup` calls `draftPlacement` immediately before `const prerequisite` (`:5122`), so `blocked`, `waiting` and `unknown` meet the phase before `:5124`. The call stays below the worker block (`:4834`): a live worker on a Draft plan's branch still reads WORKING, as the `open` arm already allows (`:4740-4743`).
- **The two existing draft returns** at `:4455-4471` and `:4744` call the same rule instead of their inline returns. Their position does not move, so the `deferred` arm still answers above the PR arm and the `open` arm still answers below its worktree check. One rule then answers all five states, and a later arm cannot forget the phase again.

No other arm changes. An Approved plan's `blocked` slice still reads NOT STARTED with `waits for <branch>, which has no pull request`.

### The order with #1150

`a-handed-slice-reads-as-taken` (#1150, `docs/plans/2026-10-01-a-handed-slice-reads-as-taken.md`) adds `withHandOver` beside `rowsFromPulse` and changes its call site, and it moves only rows whose `group` is `not-started`. This slice edits `classifyGroup` in the same file. The two do not depend on each other: after this slice, a Draft plan's slice is no longer `not-started`, so `withHandOver` does not read it. Whichever of the two merges second rebases onto the other and re-runs `pnpm run test:board`.

### Open Points

- [ ] A pulse from a scan that predates `PlanSchema.phase` carries `planPhase: ''` and can still carry `verdict: unapproved`. The rule returns `null` for `''`, as every arm in `classifyGroup` does (`:4119-4130`), so such a row keeps today's placement. The scan has emitted the phase since #140.

## Slices

### The draft rule reads every state (Branch: bug/the-draft-rule-reads-every-state)

- `bug/the-draft-rule-reads-every-state` — `draftPlacement` in `packages/domain/src/rules/draft-placement.ts` and its unit tests; the three call sites in `classifyGroup` (`packages/board/src/server/fleet.ts`); the board unit tests; a `'@plot-pm/board': patch` changeset. <!-- builds: draftPlacement places a Draft plan's branch for every state -->

## Done when

Each new test below fails on `origin/main` today, except the cases that pin unchanged behaviour:

- `packages/domain/test/draft-placement.test.ts`: a Draft plan's `blocked`, `waiting`, `unknown`, `open` and `deferred` (no reason) branch answers `waiting-on-you` with `'draft'`; a Draft plan's `deferred` branch with a reason answers `quiet` with that reason; a Draft plan's `claimed`, `wip` and `merged` branch answers `null`; an Approved plan's `blocked` branch answers `null`; `planPhase: ''` answers `null`. `draft-placement.ts` holds 100 % branch coverage under `packages/domain/vitest.config.ts:71`.
- A board unit test beside `packages/board/test/unit/a-slice-with-no-work-waits-in-not-started.test.ts`: `classifyGroup` with `planPhase: 'draft'` and state `blocked`, `waiting` or `unknown` returns `{ group: 'waiting-on-you', note: DRAFT_PLAN_NOTE }`; with `planPhase: 'approved'` and state `blocked` it returns `not-started` and `waits for <branch>, which has no pull request`; with `planPhase: 'draft'`, state `blocked` and a `running` worker it returns `working`.
- A board unit test that drives `classifyGroup` over every `BranchState` with `planPhase: 'draft'` and `verdict: 'unapproved'`, and asserts that no result has `group: 'not-started'`.
- The existing `packages/board/test/unit/draft-plan-row.test.ts` and `classifier-is-total.test.ts` pass unchanged.
- A `'@plot-pm/board': patch` changeset.
- No browser test. The placement is a domain property, and the unit tests above assert it; `EXPECTED_TESTS` in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` does not change.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck` and the domain coverage gate pass. `pnpm run test:e2e` is CI's.

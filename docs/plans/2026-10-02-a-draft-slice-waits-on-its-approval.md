# A Draft slice waits on its approval

> A slice of a Draft plan that waits on another slice renders in NOT STARTED, under *approved — nobody has taken it*. The phase check covers only two returns in the `deferred` and `open` arms of `classifyGroup`; the `blocked`, `waiting` and `unknown` arms, the fresh `claimed` and `wip` returns and every `localActivity` return never read the phase. One domain rule answers a Draft plan's branch for every state.

## Status

- **State:** Delivered
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Issue:** #1161
- **Sprint:** the-fleet-runs-through-its-limits
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Started:** 2026-10-02, jwloka, `bug/the-draft-rule-reads-every-state`
- **Delivered:** 2026-10-03

## Changelog

- A slice of a Draft plan renders in WAITING ON YOU with the note `plan not approved yet — still in review` where it rendered in NOT STARTED before: a `blocked`, `waiting`, `unknown`, `open` or `deferred` branch, a `claimed` or `wip` branch whose last commit is within the quiet window, and any branch held, dirty, locked or ahead in a local worktree. A deferred branch with a written reason keeps its QUIET placement. A stale `claimed` or `wip` branch keeps its WAITING ON YOU placement and its abandonment note. A live worker still puts the row in WORKING.
- A later slice of a Draft plan shows the draft note and no longer shows `waits for <branch>, which has no pull request`. The `waits for …` sentence returns when the plan is approved.
- The board payload no longer pairs `verdict: unapproved` with `group: not-started`, for any branch state.

Board impact: one placement rule and five call sites in `classifyGroup`. No plan-format, template or script change.

## Motivation

#1161, measured 2026-10-02 on `localhost:7777`: 15 rows rendered in NOT STARTED under *approved — nobody has taken it*, each with the note `waits for <branch>, which has no pull request`. Every one of the 15 carried `verdict: unapproved` and `startability: waiting-on-approval` in the same payload that set `group: not-started`. Example: `an-assignment-is-read-where-it-is-recorded` / `bug/the-queue-reads-the-assignment`, Draft.

**Where the two rules miss each other.** Measured on `origin/main` (`deb439b3`), 2026-10-02, in `packages/board/src/server/fleet.ts`:

- `classifyGroup` starts at `:4096`. Its `planPhase` parameter (`:4119-4130`) is documented as used *"to stop a DRAFT plan's branches reading `eligible`"*.
- The `deferred` arm (`:4397`) answers a Draft plan at `:4446-4472`: QUIET with the written reason (`:4455-4457`), otherwise `{ group: 'waiting-on-you', note: DRAFT_PLAN_NOTE }` (`:4471`).
- The `open` arm (`:4593`) answers a Draft plan at `:4734-4745` with the same result (`:4744`), below the worktree check.
- The worker block (`:4834`, `running` at `:4858`) answers any non-merged branch with a live worker.
- The no-work arms (`:5108-5134`), added by `a-slice-nobody-worked-on-reads-not-started` (released in v2.22.0), return `group: 'not-started'` for `blocked` (`:5124`), `waiting` (`:5127`) and `unknown` (`:5130`), and the catch-all for an unrecognised state does the same (`:5137`). None of them reads `planPhase`.
- The `claimed` arm (`:5016`) returns `not-started` within the quiet window (`:5053-5054`) and through `localActivity` (`:5056-5057`). The `wip` tail returns `not-started` within the quiet window (`:5145-5146`) and through `localActivity` (`:5148-5149`). The `open` arm returns through `localActivity` at `:4683-4684`, above its draft return. `localActivity` (`:5480`) answers `not-started` on every path. None of these returns reads `planPhase`.
- `DRAFT_PLAN_NOTE` is `'plan not approved yet — still in review'` (`packages/board/src/contract/schema.ts:1588`).

A slice with a `waits:` annotation reads `blocked` until its prerequisite has a PR. So every later slice of a Draft plan reaches `:5124`. The defect became visible on 2026-10-01, when most new Draft plans declared `waits:`. Commit `5da3e923` approved sixteen plans on 2026-10-02, so one live row moves when this slice lands, not 15. The rule is the same for either count.

**Measured over every state.** The round-1 skeptic called `classify` for `draft` and `approved` × all eight `BranchState` values × age `null`, 5 and 5000 minutes, with no worker and no worktree. A Draft plan placed in NOT STARTED for `blocked`, `waiting` and `unknown` at every age, and for `claimed` and `wip` at age 5. The issue's `shelved` is the `deferred` state: `shelved` is not a `BranchState` (`packages/domain/src/entities/fleet.ts:54-63`).

**The verdict already says it.** `sliceVerdict` returns `unapproved` for a plan whose phase is not `approved` (`packages/domain/src/rules/eligible.ts:107`), and `startability` returns `waiting-on-approval` for a Draft plan (`packages/domain/src/rules/verdict.ts:60`). Only the placement disagrees.

## Design

### A rule places a Draft plan's branch

A new pure rule in `packages/domain/src/rules/draft-placement.ts`, written as an arrow function:

```ts
export interface DraftPlacementReadings {
  readonly planPhase: string;       // PlanSchema.phase, verbatim; '' when the scan did not say
  readonly state: string;           // the branch's state from the pulse, verbatim, so an unrecognised word is answered too
  readonly deferredReason: string;  // the written reason on a deferred branch, '' when none
  readonly fresh: boolean;          // ageMinutes !== null && ageMinutes <= quietMinutes
  readonly local: boolean;          // localDirty || localLocked || held || localAhead > 0
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
| `draft`, `open`, `blocked`, `waiting`, `unknown` or a word that is not a `BranchState` | `{ group: 'waiting-on-you', note: 'draft' }` |
| `draft`, `claimed` or `wip`, and `fresh` or `local` | `{ group: 'waiting-on-you', note: 'draft' }` |
| `draft`, `claimed` or `wip`, neither `fresh` nor `local` | `null`: the arm's stale path already answers WAITING ON YOU with an abandonment note, which says more than the draft note |
| `draft`, `merged` | `null`: the merged arm answers DONE |

The rule answers only where a Draft plan's branch would otherwise read NOT STARTED, so after it the invariant holds for every state: no row pairs `verdict: unapproved` with `group: not-started`.

The rule is exported from `packages/domain/src/index.ts` (`export * from './rules/draft-placement.js';`), and `fleet.ts` imports `draftPlacement` from `@plot-pm/domain` like the other rules it reads (`fleet.ts:68`).

The rule returns the token `'draft'` and not the sentence, because `DRAFT_PLAN_NOTE` lives in the board's contract (`schema.ts:1588`). `classifyGroup` maps the token to `DRAFT_PLAN_NOTE`.

### classifyGroup asks the rule before the state arms

- **The no-work arms.** `classifyGroup` calls `draftPlacement` immediately before `const prerequisite` (`:5123`), so `blocked`, `waiting`, `unknown` and the unrecognised catch-all (`:5137`) meet the phase before `:5124`.
- **The `claimed` arm** calls the rule immediately before its quiet-window check (`:5053`), so a fresh claim and a claim with local activity meet the phase before `:5054` and `:5057`.
- **The `wip` tail** calls the rule immediately before its quiet-window check (`:5145`), so a fresh commit and local activity meet the phase before `:5146` and `:5149`.
- **The `open` arm** calls the rule immediately before its worktree check (`:4683`), in place of the inline return at `:4744`. A held, dirty or locked worktree on a Draft plan's `open` branch then reads WAITING ON YOU and not `held in a local worktree` in NOT STARTED. The comment at `:4734-4743` argued that a branch being edited has someone working on it; `localActivity` places that branch in NOT STARTED, not WORKING, so the argument does not survive, and only a live worker says someone is working.
- **The `deferred` arm** calls the rule in place of its inline returns at `:4455-4471`. Its position does not move, so it still answers above the PR arm.

Every call stays below the worker block (`:4834`, `running` at `:4858`): a live worker on a Draft plan's branch still reads WORKING. One rule then answers every state, and a later arm cannot forget the phase again.

No other arm changes. The PR arms still answer for a branch with a PR. An Approved plan's `blocked` slice still reads NOT STARTED with `waits for <branch>, which has no pull request`.

### Two existing tests change

`packages/board/test/unit/fleet.test.ts` asserts that `draft` equals `approved` for `['wip', 'eligible', 5]` in two cases: *changes no state but `open` and `deferred` on a draft plan* (`:956-980`) and *changes no state that carries real work — a commit, a claim, a merge* (`:1202-1223`). After this slice a Draft plan's fresh `wip` branch answers `waiting-on-you` with `DRAFT_PLAN_NOTE`, so both cases drop the `wip` age-5 tuple from the equality loop and assert it on its own: `draft` gives `{ group: 'waiting-on-you', note: DRAFT_PLAN_NOTE }`, `approved` gives `not-started` with `last commit 5 min ago`, and `delivered` and `released` still equal `approved` in the second case. The `claimed` tuple at `QUIET + 1` and the `wip` tuple at age 200 stay in the loop, because a stale branch keeps its arm's answer. The first case's title becomes *changes no stale or merged state on a draft plan*.

### The plan head's slice section is a non-goal

`deriveSlices` (`fleet.ts:4026`) sets `section` to `'done'` or `'not-started'` from `complete` alone (`:4032`), so a Draft plan's incomplete slice still carries `section: 'not-started'`. This slice leaves it. `slicesElsewhere` (`sections.ts:738`) reads `section` only when its caller passes no `here` set, and both plan-head call sites pass one (`AgentList.tsx:1667`, `:2000`). So a plan head counts its own rows and does not report its moved slice as elsewhere.

### The order with #1150

`a-handed-slice-reads-as-taken` (#1150, `docs/plans/2026-10-01-a-handed-slice-reads-as-taken.md`) adds `withHandOver` beside `rowsFromPulse` and changes its call site, and it moves only rows whose `group` is `not-started`. Its Design says a row in any other group is never moved, and names a draft plan among the answers the hand-over does not change. This slice edits `classifyGroup` in the same file.

**For a Draft plan's slice that an agent holds, the draft rule wins**, as #1150 states. After this slice no Draft row is `not-started` in any state, so `withHandOver` reads none of them, and a Draft `open`, `blocked` or fresh `claimed` slice handed to a free agent stays in WAITING ON YOU with the draft note. The agent itself still renders in WORKING through its registry row. The queue matches only `eligible` slices, and a Draft plan's slice is `unapproved`, so the queue does not hand one out. A desk whose own worker runs on the branch reads WORKING through the worker block, which outranks both rules.

**The test lands with whichever slice merges second:** a board unit test classifies a Draft plan's `blocked` branch and a Draft plan's fresh `claimed` branch through `classify`, passes each row to `withHandOver` with an agent of state `running` that names the branch, and asserts both rows are unchanged in `waiting-on-you` with `DRAFT_PLAN_NOTE`. Whichever of the two merges second rebases onto the other, adds that test and re-runs `pnpm run test:board`.

### Open Points

- [ ] Out of scope: the moved row's Open item (`menus.tsx:121`) links to a `branchUrl` with no remote ref. A Draft `open` row has the same defect today.
- [ ] A pulse from a scan that predates `PlanSchema.phase` carries `planPhase: ''` and can still carry `verdict: unapproved`. The rule returns `null` for `''`, as every arm in `classifyGroup` does (`:4119-4130`), so such a row keeps today's placement. The scan has emitted the phase since #140.

## Slices

### The draft rule reads every state (Branch: bug/the-draft-rule-reads-every-state, PR: #1260)

- `bug/the-draft-rule-reads-every-state` — `draftPlacement` in `packages/domain/src/rules/draft-placement.ts`, its export from `packages/domain/src/index.ts` and its unit tests; the five call sites in `classifyGroup` (`packages/board/src/server/fleet.ts`); the two rewritten `fleet.test.ts` cases; the board unit tests; a `'@plot-pm/board': patch` changeset. <!-- builds: draftPlacement places a Draft plan's branch for every state -->

## Done when

Each new test below fails on `origin/main` today, except the cases that pin unchanged behaviour:

- `packages/domain/test/draft-placement.test.ts`: a Draft plan's `blocked`, `waiting`, `unknown`, `open`, `deferred` (no reason) and unrecognised-word branch answers `waiting-on-you` with `'draft'`; a Draft plan's `claimed` and `wip` branch answers `waiting-on-you` with `'draft'` when `fresh` or `local` is true and `null` when both are false; a Draft plan's `deferred` branch with a reason answers `quiet` with that reason; a Draft plan's `merged` branch answers `null`; an Approved plan's `blocked` branch answers `null`; `planPhase: ''` answers `null`. `draft-placement.ts` holds 100 % branch coverage under `packages/domain/vitest.config.ts:71`.
- A board unit test beside `packages/board/test/unit/a-slice-with-no-work-waits-in-not-started.test.ts`, calling the exported `classify` (`fleet.ts:5446`), because `classifyGroup` is not exported: with `planPhase: 'draft'` and state `blocked`, `waiting` or `unknown` it returns `{ group: 'waiting-on-you', note: DRAFT_PLAN_NOTE }`; with `planPhase: 'draft'`, state `open` and a held local worktree it returns the same; with `planPhase: 'approved'` and state `blocked` it returns `not-started` and `waits for <branch>, which has no pull request`; with `planPhase: 'draft'`, state `blocked` and a `running` worker it returns `working`.
- A board unit test that drives `classify` over a pinned cross product with `planPhase: 'draft'`, `verdict: 'unapproved'` and no PR: every `BranchState` (`open`, `claimed`, `wip`, `blocked`, `waiting`, `deferred` with and without a reason, `merged`, `unknown`) × `ageMinutes` `null`, 5 and 5000 with `quietMinutes` 30 × worker `none`, `elsewhere` and `running` × local worktree absent and held. It asserts that no result has `group: 'not-started'`, that every non-merged result with worker `running` has `group: 'working'`, and that the fixture holds at least one row with age 5 and worker `none` for `claimed` and for `wip`, so the sweep cannot pass vacuously. It fails on `origin/main` today on the skeptic's 15 measured rows and on the fresh `claimed` and `wip` rows.
- The two `fleet.test.ts` cases named above assert the fresh `wip` tuple on its own, and their remaining loops pass.
- The existing `packages/board/test/unit/draft-plan-row.test.ts` and `classifier-is-total.test.ts` pass unchanged.
- The #1150 test above, in whichever of the two slices merges second.
- A `'@plot-pm/board': patch` changeset.
- No browser test. The placement is a domain property, and the unit tests above assert it; `EXPECTED_TESTS` in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` does not change.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck` and the domain coverage gate pass. `pnpm run test:e2e` is CI's.

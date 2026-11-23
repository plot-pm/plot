## Implementation brief — fleet-state-is-read-whole-and-from-one-home (slice 3: Re-run bound)

- **Plan (canonical):** docs/plans/2026-11-21-fleet-state-is-read-whole-and-from-one-home.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3609 merged
- **Branch:** `bug/the-first-red-rerun-wait-ends-at-checks-wait` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review, per the plan's `Review: pr`

This slice follows `bug/the-repair-start-decision-moves-into-the-domain` (#3659, merged 2026-11-22). It builds on `repairStartAction` and the `RerunReading` type that slice added. `bug/merge-refuses-an-unfound-state-home` waits on this slice.

### What to build

On 2026-11-06 the repair episode opened at 10:18Z on `35539a20c` (a runner failure). The re-run of its CI concluded `success` at 10:32:53Z. From about 10:43Z the head `501d32861` read red for a new, deterministic failure. fleetd logged `repair awaiting-rerun` on every tick, held 34 PRs for about two hours and started no repair, until a person opened #3199 at about 13:25Z. `rerunSettledOf` answered `pending` for three readings (runs `null`, a fold of `unknown`, an unconcluded run), and none of the three had a bound. Your change gives the wait a bound and gives the started repair its own clock:

- **The bound.** `rerunSettledOf` (`packages/domain/src/rules/repair-start.ts`) answers `{ settled: 'overdue' }` where it would answer `pending` and `now >= record.at + Checks wait`. It takes `checksWaitMs` as a new parameter (the same value `lastGreenRerunOverdue` reads; the caller `repairStartTick` in `packages/fleet/src/shared/repair-start.ts` already holds `world.checksWaitMs` or an equivalent — read how `revert-start.ts` gets it). The clock runs from `record.at`. Where `record.at` does not parse, it runs from `record.redSince`. Where neither parses, the answer is `overdue`, so an unreadable time never makes the wait unbounded. This covers the `rerun-grace` arm too: an unparseable `at` is no longer a reason to wait forever.
- **The answer.** `redMainStep` (`packages/domain/src/rules/repair.ts`) accepts `rerunSettled: 'overdue'` and answers `start-repair` in `idle` and `rerun`, whether the settled red commit is `firstRedSha` itself or a later one. Check that `repairStartAction` maps this through to `start-repair` and logs nothing as `awaiting-rerun`.
- **The repair's own clock.** `RepairAttemptSchema` (`packages/domain/src/entities/repair-record.ts`) gains optional `startedAt`, written where `startRepair` (`packages/fleet/src/shared/repair-start.ts`) first records the attempt, in the `record.attempt === undefined` write before the claim. Add a `// plot-state:` declaration for it as its neighbours carry. One domain rule, `repairBoundReached(record, now, mainRepairBoundMs)`, measures `Main repair bound` from `attempt.startedAt` where it parses, else from `redSince` as today. `redMainStep`, `revert-start.ts` (`boundReached`) and `lastGreenRerunOverdue` read it.

### Decisions the plan settles — do not re-derive them

- **A bound measured from the ask would be overtaken by the revert path.** In this repository `Checks wait` and `Main repair bound` are both 3600 s, and the repair bound runs from `record.redSince`. A repair started when the re-run bound expires would hit its own bound within about a minute, and the revert path (`redMainStep`, `revert-start.ts`) would start next. That is why `attempt.startedAt` exists. Do not "fix" it by raising a bound or by skipping the revert path.
- **`record.at` stays put while the record is `rerun`.** The refresh writes it once (`default-branch-refresh.ts`), and `repairStartTick` rewrites it only on a state change. A write to a `rerun` record that leaves `at` unchanged must not restart the bound; test that.
- **`REPAIR_RECORD_VERSION` stays 1.** The schema is `.strict()`, so an older fleetd reads a record holding `attempt.startedAt` as unreadable and answers `none` until it restarts. The operator accepted one fleetd restart after merge (decision, 2026-11-21). Add the restart note to the changeset. Do not bump the version.
- **Re-runs that settle inside the bound answer as today.** `green` and `red` do not change; only `pending` gains an end.
- **A record whose attempt has no `startedAt` measures the repair bound from `redSince`.** Records written before this change stay valid.
- **Carried invariants:** absent is not false (an unparseable time answers `overdue`, never "still waiting"); read the answer, not the emptiness (`runs: null` is `rerun-unanswered`, not no runs).

### Done when

The plan's `## Slice 3` bullets are the specification. Tests live in `packages/domain/test/repair.test.ts` and `repair-start.test.ts`, with the 2026-11-06 readings (`redSince` 10:18Z, `at` 10:20:27Z, runs `null`, head `501d32861` settled red). The assertions a naive implementation would pass without:

- At 11:19Z the answer is `awaiting-rerun`; at 11:21Z it is `start-repair`. The 11:21Z cell fails today.
- A cell at exactly `record.at + Checks wait` (catches `>` for `>=`).
- The tick after the start, at 11:22Z with `state: 'repairing'`, `attempt.startedAt` 11:21Z and the run alive, answers `await-repair`, not the revert path; at 12:21Z it reaches the bound (catches the bound still running from `redSince`).
- An unparseable `at` measures from `redSince`; an unparseable `at` and `redSince` answer `overdue`.
- `overdue` with `settled.sha === firstRedSha` answers `start-repair` (catches the `green`/`firstRedSha` special case leaking into `overdue`).
- A write to the `rerun` record that leaves `at` unchanged does not restart the bound.
- A re-run that settles `green` or `red` inside the bound answers as today.
- A record whose attempt has no `startedAt` measures the repair bound from `redSince`.
- `packages/domain/test/repair-record.test.ts` round-trips `attempt.startedAt`, and a fleet test in `packages/fleet/test/unit/repair-start.test.ts` asserts `startRepair` writes it.

Plus: a changeset (description first, `bumps:` block last, the fleetd-restart sentence included). The board bundle is generated: run `pnpm build:board` only to test and commit no bundle (`scripts/check-no-bundle-diff.sh` refuses one). Before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count; if you touch one, pay for the growth in the same change. A new function is an arrow. TSDoc states what an export does and returns, not the history.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to this branch's line under `### Re-run bound` in the plan's `## Slices` section.

### Scope guard

This branch owns: `packages/domain/src/rules/repair-start.ts`, `rules/repair.ts`, `entities/repair-record.ts`, `packages/fleet/src/shared/repair-start.ts`, `packages/fleet/src/shared/revert-start.ts`, their tests, and the changeset. It does not own: `MergeReadings`/`mergeAt` (slice 4, `bug/merge-refuses-an-unfound-state-home`), the state-home adapters (slices 1 and 5), the pulse readers (slices 6 and 7), and `firstRedFailing` with the new-failure comparison in `redMainStep` (slice 8, `bug/a-new-failure-on-main-starts-a-repair` — leave `redMainStep`'s `idle`/`rerun` branch open for it to add one more `start-repair` condition). Earlier slices: #3624 and #3659 are merged.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

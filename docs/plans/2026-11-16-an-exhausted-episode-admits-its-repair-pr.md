# An exhausted episode admits its repair PR

> While the default branch is still red on its first red commit, `plot-ask.mjs merge` and fleetd's merge arm admit the repair PR that an `exhausted` repair record names, and a test at the workflow level proves it.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #3281
- **Review:** pr
- **Impl:** own branches

## Changelog

- A merge of the repair PR that an `exhausted` repair record names is proved by a `mergeAt` test and a merge-arm test, so a later change cannot make that PR refuse `repair-episode-closed` again.

<!-- Board impact: none. No change to the plan format, the template, the helper scripts or the docs/plans layout. -->

## Motivation

On 2026-11-08 `main` went red on `e93c6b8fd`. A person recorded repair PR #3280 with `plot-ask.mjs repair-pr 3280`. At 20:44:56Z the record moved to `exhausted` while #3280 was still in CI. When CI went green at 21:44, `plot-ask.mjs merge 3280 87df144d3` refused `repair-episode-closed`, and a person merged #3280 on GitHub, outside the controller (#3281).

The cause was `repairEpisode` in `packages/domain/src/rules/repair-pr.ts`, which read an `exhausted` record as `closed`. Both `readRepair` (`packages/domain/src/workflows/merge.ts:463`) and the repair-pr workflow (`packages/domain/src/workflows/repair-pr.ts:67`) ask that rule.

**The defect is fixed on main.** Commit `779e170c1` ("plot: an exhausted repair episode takes a person's repair PR", 2026-11-15, merged with #3454) removed `exhausted` from the closed check. `packages/domain/src/rules/repair-pr.ts:100` now reads `if (record.state === 'done') return 'closed';`, and the TSDoc at lines 78–86 states that an `exhausted` record is open while the settled commit is red and its first-parent line holds `firstRedSha`. `CLAUDE.md` states the same rule under *The Master Agent Uses The Controllers*. This plan's slice selects the issue's first shape: `exhausted` stops fleetd's own steps and does not close the episode.

`exhausted` still stops fleetd's own steps, as the issue asks:

- `redMainStep` answers `none` for an `exhausted` record (`packages/domain/src/rules/repair.ts:250`).
- `repairStartTick` returns before it asks the host (`packages/fleet/src/shared/repair-start.ts:96`, commit `f2e5b77a1`).
- `revertStart` answers `none` (`packages/fleet/src/shared/revert-start.ts:174`).

What remains is proof. Commit `779e170c1` tests the rule alone (`packages/domain/test/repair-pr.test.ts:115`, *"stays open for an exhausted record while main is red on its first red commit"*). No test drives an `exhausted` record through `mergeAt` (the `describe('mergeAt — the repair PR on a red default branch')` suite at `packages/domain/test/workflows-merge.test.ts:693` uses `state: 'repairing'` at line 707). No test drives it through the merge arm's `slicePrNext` (`packages/domain/test/slice-pr-next.test.ts:544`). The issue's *Done when* asks for exactly these two checks.

One write path can still drop a recorded `repairPr`. `keepsRepairRecord` (`packages/domain/src/rules/repair-pr.ts:206–211`) returns false for an `exhausted` record. `writeRepairRecord` (`packages/fleet/src/shared/default-branch-refresh.ts:203`) then replaces the record with a fresh `idle` one that has no `repairPr`. The write runs only on a change from a non-red settled reading to a red one (`default-branch-refresh.ts:350`). For the same first red SHA, that change needs a carried reading that is missing or unreadable, for example after `.plot/state/default-branch.json` is removed. See the open question.

## Design

### Approach

The fix is in the domain rule `repairEpisode` and is already on main. The slice adds tests only, with no production change unless the open question selects option A.

1. In `packages/domain/test/workflows-merge.test.ts`, in the `mergeAt — the repair PR on a red default branch` suite, add one test. Use `record({ state: 'exhausted' })` with `repairPr: 7`, a fresh red reading and red re-asked runs. Assert `merged: true` and one `pr-merge` call pinned to the head.
2. In the same suite, add one test with the same `exhausted` record and PR 8, which the record does not name. Assert `reason: 'default-branch-red'` and that nothing is walked.
3. In `packages/domain/test/slice-pr-next.test.ts`, add one test where the merge arm's `repairMerge` reading carries an `exhausted` record with `episode: 'open'`. Assert `{ step: 'merge' }` for the named PR.
4. Add a changeset for `plot` (patch) with a `bumps:` block naming `plot`.

The change has no shell/domain duplicate and no corpus row. It reads no index and adds no spawn.

### Open Questions

- [x] **Does an `exhausted` record that carries a `repairPr` survive a re-detected change to red on the same first red SHA?** Today `keepsRepairRecord` replaces it with an `idle` record, which drops `repairPr` and restarts fleetd's own repairs.
  - A: Keep an `exhausted` record where `repairPr` or `revertPr` is set. Change one clause in `keepsRepairRecord`, and add one test in `packages/domain/test/repair-pr.test.ts`.
  - B: Keep the current behaviour. A restarted repair is a second chance, and the person records the PR again with `plot-ask.mjs repair-pr`.
  - **Recommendation: A.** The record names a person's PR, and the PR is the one way left to end the episode. A replacement drops it silently, and the next merge of that PR refuses `default-branch-red`.
  - **Decided 2026-11-16, Jan Wloka: option A.**

## Done when

| Claim | Check | Slice |
|---|---|---|
| An `exhausted` record's `repairPr` merges through `mergeAt` on a fresh red reading | new test in `packages/domain/test/workflows-merge.test.ts` › `mergeAt — the repair PR on a red default branch`: *"merges the repair PR an exhausted record names"* | Proof |
| A PR that an `exhausted` record does not name still refuses `default-branch-red` | new test in the same suite: *"refuses default-branch-red for a PR an exhausted record does not name"* | Proof |
| fleetd's merge arm merges the repair PR that an `exhausted` record names | new test in `packages/domain/test/slice-pr-next.test.ts`: *"admits the repair PR an exhausted episode names"* | Proof |
| The rule still reads an `exhausted` record as open on a red first-parent line | existing test `packages/domain/test/repair-pr.test.ts:115` passes | Proof |
| An `exhausted` record that names a `repairPr` or `revertPr` survives a re-detected red on the same first red SHA | new test in `packages/domain/test/repair-pr.test.ts`: *"keeps an exhausted record that names a repair PR"*; it fails on today's `keepsRepairRecord` | Proof |
| The tests fail against the defect | revert line 100 of `packages/domain/src/rules/repair-pr.ts` to `if (record.state === 'done' \|\| record.state === 'exhausted') return 'closed';` locally; the three new tests fail; restore the line | Proof |

## Slices

### Proof

- `bug/an-exhausted-episode-admits-its-repair-pr` — two tests in `packages/domain/test/workflows-merge.test.ts`, one test in `packages/domain/test/slice-pr-next.test.ts`, and a changeset for `plot` (patch, `bumps:` block naming `plot`); one clause in `keepsRepairRecord` (`packages/domain/src/rules/repair-pr.ts`) and one test in `packages/domain/test/repair-pr.test.ts` <!-- builds: keepsRepairRecord keeps an exhausted record that names a person's PR, and tests that an exhausted episode admits its repair PR -->

## Notes

- Fix on main: `779e170c1` (rule and rule test, merged with #3454). Related: `f2e5b77a1`, where a `done` or `exhausted` record asks the host nothing in `repairStartTick`.
- `plot-deliverable-search.sh "an exhausted episode admits its repair PR"` and `"exhausted repair"`: no deliverable with this name. The hits are the existing `exhausted` handling in `packages/fleet/src/shared/repair-start.ts` and `revert-start.ts`, and unrelated uses of the word in `plot-dispatch.sh`, `auto-ticket.ts` and `fleet.ts`. None is a duplicate.
- The issue names `repair-pr.ts:98` as the closed check. On main that check is at line 100.

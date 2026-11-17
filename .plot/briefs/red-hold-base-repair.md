## Implementation brief — red-hold-reads-the-pr-base (slice: Base repair)

- **Plan (canonical):** docs/plans/2026-11-09-red-hold-reads-the-pr-base.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3323 merged
- **Branch:** `bug/red-hold-base-repair` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** the `plot/review` check on the PR head, per the plan's `Review: pr`

This is slice 4 of 4, and nothing waits on it. The three slices before it are merged: `bug/red-hold-index-base` (#3479, `9439e1bf1`), `bug/red-hold-reads-the-pr-base` (#3483, `e2fa8bf18`) and `bug/red-hold-base-readings` (#3486, `f7f461a76`). `PrIndexRowSchema` carries `base`, `mergeArm` and `merge` hold a sprint PR `base-branch-red` from `.plot/state/base-branches/<base>.json`, and fleetd writes one reading per `sprint/*` branch through `refreshBases` (`packages/fleet/src/shared/default-branch-refresh.ts`). This slice adds the way out of a red sprint base.

### What to build

Today a red `sprint/x` holds every PR into it `base-branch-red` until `sprint/x` turns green. Nothing can turn it green except a fix PR into `sprint/x`, and that PR is held by the same red. On the default branch the repair exception solves this: the one PR the repair record names merges while `main` is red. A sprint base has no record and no exception, so a person merges the fix on GitHub, outside every controller. Issue #3322's three PRs were that path.

Build the same exception for a base, in four pieces:

- **A per-base repair store.** `.plot/state/base-branches/<base>.repair.json`, in `RepairRecordSchema` (`packages/domain/src/entities/repair-record.ts`), with `branch` set to the base. Add the adapter next to `repairRecordFile` (`packages/domain/src/adapters/repair-record/repair-record-file.ts`) and share its read and atomic temp-and-rename write rather than copy them. It guards the path as `baseBranchFile` does: a base with an empty, `.` or `..` segment reads as no record and refuses a write, and a file whose `branch` is not the base reads as no record.
- **fleetd writes it.** `BaseRefreshWorld` (`default-branch-refresh.ts`) gains `repairFor(base): RepairRecordStore`, and `refreshBases` passes it as the base world's `repair`. `refreshDefaultBranch` already calls `writeRepairRecord` at a change from green to red where `world.repair` exists, so a red sprint reading opens an episode with that base's `lastGreenSha` and `branch: base`. Wire `repairFor` in the beat at `registryd-main.ts` (the `refreshWithBases` call that already passes `storeFor`). The beat also deletes a base's record where it deletes its reading file because the listing no longer names the base: extend `remove` to delete both, and keep `removeBaseBranch`'s guard.
- **`plot-ask.mjs repair-pr` reads the PR's base.** `nameRepairPrAt` (`packages/domain/src/workflows/repair-pr.ts`) asks `prState` first, only to learn the base. A PR into a non-default base (`holdsApply(base, defaultName)` false) is recorded on that base's record, checked against that base's reading, and its head must be `bug/sprint-repair-<12 hex of the base's lastGreenSha>`. `NameRepairPrPorts` gains the base stores as optional factories, like `MergePorts.baseBranch`. Wire them in `packages/board/src/server/entry/main.ts` (the `repair-pr` branch). The refusals keep the default branch's names: `no-open-episode`, `no-last-green`, `pr-not-open`, `repair-branch-mismatch`, `repair-pr-already-named`, `record-moved`, `unaskable`.
- **`merge` and `mergeArm` admit the base's repair PR.** Where `baseBranchRed` holds, the base's record, its episode and the red commit's runs asked again go through `repairMergeVerdict`, exactly as the default branch's do. `not-named` keeps `base-branch-red`; `refused` returns the verdict's reason; `admitted` passes. In `mergeAt` (`workflows/merge.ts`) read it with `readRepair` against the base's record store and reading, last, so the runs are asked immediately before the merge; add `MergePorts.baseRepair?: (base: string) => RepairRecordStore`. In `mergeArm` (`rules/slice-pr-next.ts`) read a new `SlicePrNextReadings.baseRepairMerge`, and have `auto-merge.ts` build it once per tick for each red base that a record names an open row for, as `repairReading` does for the default branch. `conflicting` and the merge identity still apply after admission.

Then update `CLAUDE.md`, paragraph *One hold reads a non-terminal answer*: it still says *"No writer of the base files exists yet, so until one ships a sprint PR is held by nothing"*, which slice 3 made false. Replace that sentence with the writer, add the base repair arm (record path, branch name, what admits, what refuses), and run `./scripts/check-agents-md.sh --write` so the `AGENTS.md` mirror follows.

### The decisions the plan settles — do not re-derive them

**One record per base, in its own file, and the default branch's record does not change (decided 2026-11-10, jwloka).** Rejected: a keyed file for all bases, because two refreshes would race on one read-fold-write, the same reason the readings are one file each. Rejected: putting the base's episode into `.plot/state/repair-record.json`, because `repair-start.ts`, `revert-start.ts` and `repairReading` in `auto-merge.ts` read that file as the default branch's and would start a repair agent on a sprint branch. A test must assert `.plot/state/repair-record.json` is byte-identical after a red sprint reading.

**Only a repair PR. No revert arm, no fixer agent.** The base's branch is `bug/sprint-repair-<12 hex>`, not `bug/main-repair-…`, and `bug/revert-<n>` does not apply. Nothing writes `revertPr` on a base record, and nothing starts an agent for one: the base's record is read by a person's `repair-pr` and by the merge, and by nothing else. Do not add a fixer, a re-run or a revert for a base.

**A green reading closes the episode, and no writer sets `done`.** `repairEpisode` (`rules/repair-pr.ts:94`) returns `closed` for any record whose reading is not settled red, whatever `state` says. Do not build a writer of `state: 'done'` for a base. A later red episode has a different `firstRedSha`, so `keepsRepairRecord` replaces the old record.

**The base has no repair branch until it has a last green SHA.** `writeRepairRecord` sets `lastGreenSha` from the carried settled reading. A base whose first reading is red has none, so `mainRepairBranchOf`'s base twin returns null and `repair-pr` refuses `no-last-green`. That is the default branch's behaviour, and it is the safe direction: the PR stays held, and a person merges on the host as today. Report it if it bites; do not invent a fallback name.

**The existing exports keep their signatures and their rows.** `repairBranchMatches`, `repairMergeVerdict` and `mainRepairBranchOf` are used by the default-branch path, and every existing row in `repair-pr.test.ts`, `workflows-merge.test.ts`, `slice-pr-next.test.ts` and `ask-repair-pr.test.ts` passes unchanged. Add the base's branch name as a sibling (`sprintRepairBranchOf`), and choose between the two by what the record names, not by a new required argument. `repairRoleOf` must not read `revertPr` on a base record as a revert.

Invariants carried over from the earlier slices: a missing, unparseable or mismatched file means no record and no admission (*the index never says no*); a failed read of the base's record is `unaskable`, never absent; a refusal ends the action, so `mergeTick` must not retry past `repair-red-unconfirmed` or `repair-branch-mismatch`; `mergeArm` makes no call and reads only what `auto-merge.ts` handed it.

### Traps that a naive implementation walks into

**`baseBranchNames` lists the record as a base.** It returns every `*.json` under `base-branches/`, so `sprint/x.repair.json` reads as a base named `sprint/x.repair`. `refreshBases` then finds that name absent from `tips` and `remove`s it, which deletes the repair record on the first beat after it is written. Fix it in `baseBranchNames` (skip `*.repair.json`) and name the collision: a branch called `sprint/x.repair` would share a reading path with the record of `sprint/x`, so `validBase` must refuse a last segment that ends in `.repair`. The beat must delete a record only together with its base's reading file, never alone as a base.

**The unsettled commit may be absent locally.** `readRepair` walks `firstParentLine(settled.sha, 200)`. A sprint tip that was never fetched gives no line, and the verdict is `unaskable`. That refuses, which is safe; assert it as a row rather than treating it as a bug.

**The episode must be checked against the base's reading, not `main`'s.** `repairEpisode(record, branch, settled, line)` compares `record.branch` with the branch the reading names. Passing the default branch's reading for a base PR reads `closed` or, worse, `open` on the wrong commit.

### Done when

The plan's `## Done when` rows with slice *Base repair* are the specification:

- a `default-branch-refresh.test.ts` row: a red `sprint/x` reading writes `.plot/state/base-branches/sprint/x.repair.json` with that base's `lastGreenSha`, a green reading reads as a closed episode, and `.plot/state/repair-record.json` does not change;
- a `merge` row and a `slicePrNext` row: a PR into `sprint/x`, named as `repairPr` on the base's open record, head `bug/sprint-repair-<12 hex>`, runs still red, merges or selects `merge`; another PR into `sprint/x` refuses or holds `base-branch-red`;
- a `plot-ask.mjs repair-pr` row (`packages/board/test/unit/ask-repair-pr.test.ts`): a PR into `sprint/x` is recorded on the base's record; a head that does not match, no open episode and a second repair PR refuse by the default branch's names.

Add these because a naive implementation passes without them:

- **A beat writes a record and the next beat keeps it.** Catches the `baseBranchNames` trap above: two `refreshWithBases` passes with one red base, and the record file exists after the second.
- **A repair PR named on `sprint/x`'s record but opened into `sprint/y` is not admitted.** Catches an admission keyed by PR number alone.
- **A repair PR named on the *default branch's* record but opened into `sprint/x` is not admitted.** Catches the default-branch exception leaking onto the sprint path, and the reverse: a PR named on a base record but opened into `main` gets nothing.
- **`repair-red-unconfirmed` on a base.** The runs asked again read `pending` or `green`: the merge refuses with that name and `mergeArm`'s selection still holds `base-branch-red` for every other row.
- **A base with no reading opens no record, and a base the listing drops loses both files.** Catches a beat that writes a record for a base it never read, and one that leaves the record behind.
- **An `auto-merge.test.ts` row** where the tick selects the base's repair PR on a red `sprint/x` and `mergeAt` merges it, so selection and merge-time agree.

Plus the repo's gates: no bundle in the diff (`board-server.mjs` is generated; never commit a rebuild), and a changeset (`'plot': patch`, description first, `bumps:` block last, `plan: docs/plans/2026-11-09-red-hold-reads-the-pr-base.md`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI; a failure there comes back as a correction. Do not run `test:e2e` locally. This slice should touch no `.sh` file, so `scripts/check-shell-lines.sh` is not at risk. The census gate compares S4: the per-base record read happens only inside a base refresh that already asks the host, so an idle pass must still start no process — keep it that way. New functions are arrows (`export const f = (…) => …`), and TSDoc says what an export does, not the history of the decision.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while work moves); never `gh pr create`. Append `→ #<number>` to this branch's line under `### Base repair` in the plan. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/repair-pr.ts`, `rules/slice-pr-next.ts`, `workflows/merge.ts`, `workflows/repair-pr.ts`, `adapters/repair-record/`, `adapters/default-branch/default-branch-file.ts` (`baseBranchNames`, `removeBaseBranch`, `validBase`), `adapters/index.ts` for the new export, `packages/fleet/src/shared/default-branch-refresh.ts`, `packages/fleet/src/shared/auto-merge.ts`, the beat's wiring in `packages/fleet/src/server/entry/registryd-main.ts`, `packages/board/src/server/entry/main.ts` (the `repair-pr` branch), the matching tests, `CLAUDE.md` with its `AGENTS.md` mirror, and the changeset.

Other branches in flight: verified 2026-11-17 by diffing every remote branch against `origin/main`, none touches these files. `changeset-release/main` only deletes a changeset.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

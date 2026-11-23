## Implementation brief — fleet-state-is-read-whole-and-from-one-home (slice 8: New main failure)

- **Plan (canonical):** `docs/plans/2026-11-21-fleet-state-is-read-whole-and-from-one-home.md` on `main` — read "Slice 8, a new failure starts a repair (#3208)" and the Open Questions
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3609 merged
- **Branch:** `bug/a-new-failure-on-main-starts-a-repair` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the last slice. Every earlier heading is merged (the last, "Domain pulse lookup", is #3687). Slice 3 already put the `overdue` answer and `repairBoundReached` into `repair.ts`; this slice adds a second way out of the `idle`/`rerun` wait and touches the repair rules only.

### What to build

On 2026-11-06 the episode opened at 10:18Z on `35539a20c` (a runner failure). Its re-run went green at 10:32:53Z. From about 10:43Z the head `501d32861` read red for a new, deterministic failure, and fleetd held 34 PRs for about two hours until a person opened #3199. Slice 3 bounds the wait at `Checks wait`. This slice removes the wait itself where the evidence is already there: a later commit settled red and fails in different jobs than the first red commit did.

- **Schema.** `RepairRecordSchema` (`packages/domain/src/entities/repair-record.ts`, `.strict()` at `:169`) gains an optional `firstRedFailing`: the sorted failing job names of `firstRedSha`. `REPAIR_RECORD_VERSION` stays 1.
- **Write.** `writeRepairRecord` (`packages/fleet/src/shared/default-branch-refresh.ts:278`) writes the field once, where it opens the episode. `settled.failingRuns` is what it has at that point, so the names must reach it through the settled reading's failing runs.
- **Rule.** `redMainStep` (`packages/domain/src/rules/repair.ts:243`) answers `start-repair` in `idle` or `rerun` where `reading.settled.sha` is after `record.firstRedSha`, is red, and its failing job names differ from `record.firstRedFailing`, whatever `rerunSettled` reads. A record without `firstRedFailing` compares nothing and answers as today. Update the TSDoc bullet for `idle`/`rerun` (`:221-228`) to state the new arm.
- **Fleet.** `repairStartTick` (`packages/fleet/src/shared/repair-start.ts`) already dispatches on `redMainStep`'s answer. It needs the settled commit's failing job names as a reading value; the domain takes readings and never asks a port.

### The first thing to check — the plan's premise may not hold

The plan says the job names "come from the job entries that `runsForSha` lists (`ports/build.ts:115-125`, `entities/build.ts:158-161`)". Read `packages/domain/src/adapters/build/build-actions.ts:71-115` before you write anything. `runsForShaInProcess` adds a job entry **only for a declared `<workflow>/<job>` name**, and its `workflow` field is that declared name. This repository declares one check, `CI/validate`, so a failing `board-integration` job and a failing job that ran `ports-real-state.test.ts` both fold under `CI/validate`. Both would read as the same name, and the comparison would never differ. `failingRunsOf` (`rules/default-branch.ts:154`) has the same limit: it returns the run's `workflow`, which is the declared name.

The operator decided the unit is job names, not declared check names (2026-11-21). Whether the build port can supply them is not settled. **Write a failing test first**: feed `runsForSha` two runs of one workflow whose failing jobs differ, with `declared: ['CI/validate']`, and see whether the two failing job names are readable. If they are, build on that. If they are not, stop and report what the port lacks. The smallest candidate is the failing job names of a failed run, added to `WorkflowShaRun` from the `jobs` call the adapter already makes (`GithubRuns.jobs`, which carries `one.name`). That changes a port shape the plan does not name, so it needs a person's yes before you build it. Do not substitute declared check names to make the test pass: that fails the 2026-11-06 case this slice exists for.

### Settled decisions — do not re-derive them

**Job names, not check names.** `failingRuns` holds the declared check names, and both 2026-11-06 failures fold under `CI/validate` (plan, Open Questions). A comparison of those never differs.

**The record keeps version 1.** `RepairRecordSchema` is strict, so a fleetd built before this change reads a record that holds `firstRedFailing` as unreadable and answers `none` for the episode (`repair-start.ts:97`) until it restarts. One restart after merge is accepted (operator decision, 2026-11-21). Do not bump the version and do not loosen `.strict()`. The Changelog already says "Restart fleetd once after these changes merge" — keep it true.

**Absent is not false.** A record with no `firstRedFailing` was opened before this field existed, or with no runs to read. It compares nothing. An empty array is a measured fact (the first red failed in no named job) and is not the same as an absent field.

**The first red SHA itself never starts a repair here.** The arm reads a settled commit *after* `firstRedSha`. A re-reading of `firstRedSha` keeps today's `await-rerun`, because two readings of one commit disagree for one beat.

**Where the decision lives.** The comparison is a rule in the domain with the two name lists as inputs. `repairStartTick` stays port calls and writes.

### Done when

The plan's `## Done when` list and Slice 8's **Tests** bullet are the specification. Lifted from them, with what each catches:

- `packages/domain/test/repair.test.ts`: the two 2026-11-06 job names (`board-integration` on the first red, the job that ran `ports-real-state.test.ts` on `501d32861`) with `rerunSettled: 'pending'` answer `start-repair`. This cell must fail on `main` today; it is the one that proves the slice. The same job names with the same name list answer `await-rerun`. A record without `firstRedFailing` answers `await-rerun`.
- A cell for each `rerunSettled` value (`pending`, `none`, `green`, `red`, `overdue`) with different job names. It catches an arm that reads `rerunSettled` after all.
- A cell where the settled commit is `firstRedSha` itself with different names answers `await-rerun`. It catches an arm that drops the "after" test.
- A cell with the names equal but in another order. Sorted storage must make the comparison order-free.
- `packages/domain/test/repair-record.test.ts` round-trips `firstRedFailing`, and a record without it still parses.
- `packages/fleet/test/unit/default-branch-refresh.test.ts`: the opened record carries `firstRedFailing` from the settled reading, and a refresh that keeps an existing record rewrites nothing (`keepsRepairRecord`).
- `packages/fleet/test/unit/repair-start.test.ts` gains one cell: a later red with other job names reaches `start-repair` through the tick.
- The plan says `rerunSettled: 'green'` with a later red already answers `start-repair` today (`repair.ts:262`). That cell passes today and proves nothing; do not count it as the failing-today test.

Plus: arrow functions for everything you write (`export const f = (…) => …`), and factual TSDoc with no history. Add a changeset for `plot` with the description first and the `bumps:` block last, naming this plan on a `plan:` line; run `./scripts/check-changeset-packages.sh`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite and do not run `test:e2e` locally. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. Do not commit a rebuilt `board-server.mjs`: `scripts/check-no-bundle-diff.sh` refuses it.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns: `packages/domain/src/rules/repair.ts`, `packages/domain/src/entities/repair-record.ts`, `packages/fleet/src/shared/default-branch-refresh.ts`, `packages/fleet/src/shared/repair-start.ts`, the tests named above, and the changeset. If the port needs job names, it also owns `packages/domain/src/entities/build.ts` and `packages/domain/src/adapters/build/build-actions.ts` — but only after a person agrees.

No other slice of this plan is in flight. The Approved plan `2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr` cites `repair-start.ts:214`; slice 2 may have shifted it, so re-read before you assume a line.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

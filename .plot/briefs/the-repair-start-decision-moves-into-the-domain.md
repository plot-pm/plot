## Implementation brief — fleet-state-is-read-whole-and-from-one-home (wave 2: Repair-start decision)

- **Plan (canonical):** docs/plans/2026-11-21-fleet-state-is-read-whole-and-from-one-home.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3609 merged
- **Branch:** `bug/the-repair-start-decision-moves-into-the-domain` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (auto-review, `plot/review` status)

This wave waits on wave 1 (`bug/merge-reads-the-main-checkouts-state`, #3624). It blocks wave 3 (`bug/the-first-red-rerun-wait-ends-at-checks-wait`), which adds `overdue` on top of the reasons this slice introduces.

### What to build

Today `repairStartTick` (`packages/fleet/src/shared/repair-start.ts`) holds part of the repair-start decision. It builds `rerunSettled` from a `runsForSha` ask, where a failed or budget-skipped ask becomes `null`. It maps `await-rerun` to `awaiting-rerun` where `record.rerun !== 'none'`. On 2026-11-06 this held 34 PRs for about two hours with one log line, `repair awaiting-rerun`, on every tick. The log did not say whether runs were `null`, whether no declared check matched a run, or whether a matched run was still going. This slice moves the decision into the domain and makes it name its reason, so the next episode is measurable. It changes no outcome and adds no bound; the bound is wave 3.

Build on what exists in `packages/domain/src/rules/repair-start.ts` and `repair.ts`:

- `rerunSettledOf` answers its reason beside the reading: `rerun-unanswered` (runs `null`), `rerun-unmatched` (the declared checks matched no run: `foldRuns` answers `unknown`, see `unmatchedChecks` in `default-branch.ts`), `rerun-unconcluded` (a matched run is still going) and `rerun-grace` (inside `RERUN_GRACE_MS`, or `record.at` does not parse). A settled `green`, `red` or `none` carries no reason.
- `repairStartAction(input)` in `rules/repair-start.ts` takes `redMainStep`'s answer, the record, whether a reading exists, the PR reading and the run reading. It answers `ask-rerun`, `awaiting-rerun` (with the reason), `start-repair`, `record-pr`, `awaiting-repair` or `none`.
- `repairStartTick` keeps only port calls and writes. It dispatches on `repairStartAction`'s answer and logs `repair awaiting-rerun (<reason>)` through the existing `warn` or log channel the tick already has. `RepairStartOutcome` keeps its present words.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **No bound in this slice.** `rerunSettledOf` does not answer `overdue` here. The bound is wave 3 and reads `Checks wait` measured from `record.at`. Adding it here makes wave 3's failing cells (`start-repair` at 11:21Z) pass early and leaves wave 3 with nothing to prove.
- **The reasons are four, not three.** Panel round 1 found `rerun-unmatched` missing: a fold of `unknown` is a different reading from `null` and from an unconcluded run, and the 2026-11-06 log cannot say which one held. The `rerun-unmatched` cell uses `runs: [run('CI', 'success')]` and `checks: ['CI/validate']`.
- **The record keeps its shape.** `REPAIR_RECORD_VERSION` stays 1 and this slice adds no record field. `attempt.startedAt` is wave 3 and `firstRedFailing` is wave 8.
- **Layering.** The decision is a domain rule over readings as values. It imports no port and awaits nothing. `repairStartTick` is the only caller that asks a port. The domain package uses arrow functions (`export const f = (…) => …`), and TSDoc states what an export does, returns and how it fails, with no history. The reasoning goes in the commit message.
- **Absent is not false.** A `null` runs reading is `rerun-unanswered`, never `green` or `red`. Do not fold it.
- **Behaviour is preserved.** Every branch of today's `repairStartTick` (the `await-rerun`, `start-repair` and `await-repair` arms, and the `held` returns) answers as before. The tick returns `awaiting-rerun` for the same inputs as today.

### Done when

The plan's slice 2 `Tests` list is the specification:

- `packages/domain/test/repair-start.test.ts` holds today's answer for each branch of `repairStartTick`, including `awaiting-rerun` for the 2026-11-06 inputs with `runs: null`. It gains one cell per reason. The reason cells fail today because `rerunSettledOf` answers no reason; write them first and watch them fail.
- `packages/fleet/test/unit/repair-start.test.ts` passes unchanged except for the log line.

Assertions that exist because a naive implementation would pass without them:

- A `repairStartAction` cell for each of the six answers, so a dispatch that collapses `ask-rerun` into `awaiting-rerun` fails.
- A cell where `record.rerun === 'none'` with a red reading answers `ask-rerun`, and one where `record.rerun === 'asked'` with `runs: null` answers `awaiting-rerun` with `rerun-unanswered`. The old tick distinguishes these by `record.rerun !== 'none'`; the move must keep that split.
- A cell where `reading` is `null` answers `awaiting-rerun` or `none` exactly as today's tick does; characterise it first.
- A log assertion in the fleet test: the line names the reason, for each of the four.

Plus the gates:

- Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.
- The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` is not in play. If that changes, the shell growth is paid for in the same change.
- Add a changeset. Description first, `bumps:` block last, package `plot` or `@plot-pm/board`. This slice changes fleetd, so check the changeset gate with `./scripts/check-changeset-packages.sh`.
- Commit no board bundle (`scripts/check-no-bundle-diff.sh` refuses one).

### Bookkeeping

- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/repair-start.ts`, `packages/domain/test/repair-start.test.ts`, `packages/fleet/src/shared/repair-start.ts` and `packages/fleet/test/unit/repair-start.test.ts`, plus the changeset. Touch `rules/repair.ts` only if `repairStartAction` needs an export from it; do not change `redMainStep`'s answers (wave 3 and wave 8 do).

In flight: wave 1 (#3624) changes the callers of the four state-file adapters, including `repair-start-world.ts:64,67`. Expect a trivial rebase conflict there, not here. Wave 3 edits `rerunSettledOf` and `redMainStep` after this merges.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

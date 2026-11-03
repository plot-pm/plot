# A release through release-approve leaves its issues at plan:delivered

> `finishRelease` books a release's plans as Released and makes no tracker call. Release v2.30.0 booked 24 plans through it on 2026-11-03, and no issue received `plan:released` or was closed.

## Status

- **State:** Delivered
- **Type:** feature
- **Issue:** #3066
- **Sprint:** follow-ups-2-30-1
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3071 merged
- **Started:** 2026-11-03, Jan Wloka, `bug/release-finish-refuses-another-sprint`
- **Started:** 2026-11-03, Jan Wloka, `bug/release-approve-tells-its-tracker`
- **Delivered:** 2026-11-03

## Changelog

- A release approved through `release-approve` tells the tracker about each plan it books, as the per-plan release command already does: on GitHub the issue gets `plan:released` and closes. A tracker failure prints one `tracker=failed <issue>` line and does not fail the release.
- `release-approve` refuses `release-scope-mismatch` and writes nothing when the active sprint's `Release:` field names a different version than the one being released, so a re-run on an old merged release PR no longer books the next sprint's plans under the old tag.

Board impact: **none expected.** The change runs in the board's server entry code and the domain's release-finish workflow. The plan format, template and helper scripts keep their shape.

## Motivation

Release v2.30.0 went through `plot-ask.mjs release-approve` on 2026-11-03 at 15:01Z. `finishRelease` booked 24 plans as Released (`7c1317c9e`). Those 24 plans name 24 issues: one plan names #2993 and #3040, and `2026-10-30-ci-runs-what-the-change-touches.md` names none. No issue received `plan:released` and no issue was closed by the finish.

The tracker write exists only in the per-plan release command, `runRelease` (`packages/board/src/server/entry/deliver.ts:921-1016`). It does three things: it reads the sibling plans from the booked tree to find issues that another unfinished plan names, it runs `plot-issue-status.sh`, and it runs `plot-plan-state.sh --phase released --version <tag>`, which labels the issue and closes it. `finishRelease` (`packages/board/src/server/entry/release-finish.ts:104`) flips `State:`, closes the sprint and pushes, and makes no tracker call. Releases 2.29.0 and 2.29.1 were booked per plan through `runRelease`. Release 2.30.0 is the first one booked through `finishRelease`.

Nothing repairs the gap automatically. fleetd's `runAutoProgressPass` writes `approved` progress only. A second `release-approve` stops on `already-released` (`release-finish.ts:267`) before any step that could reach the tracker. `/plot-reconcile` runs `plot-released-labels.mjs --section` (`plot-reconcile-scan.sh:3543`), which reads closed issues only (`rules/released-labels.ts:71` skips an open one), so an open issue that only Released plans name is invisible to it.

The repair ran by hand. A person relabelled #2898 and #2997 at 16:57Z, the per-plan path booked a 25th plan (`2026-10-31-the-fleet-scan-re-reads-what.md`, #2978) in `c24a65b74` at 17:52 +0100, and `plot-deliver.mjs --release v2.30.0 <slug>` then re-ran the tracker step for the remaining Released plans. Read on 2026-11-03 after that repair: all 25 issues named by v2.30.0 plans are CLOSED with `plan:released`. Each of those hand steps is an intervention the sprint goal counts.

## Design

### Approach

**Scope: the first run only (decided).** `finishRelease` runs the tracker step once for each plan it books. The step runs after the final push lands and before `cleanup()` removes `tmpwt` (`release-finish.ts:297`). It runs once over the final `booked` list, not once per `reapply` attempt, so a rejected-then-accepted push writes N times and not 2N. A rejected push runs no tracker step and prints `tracker=skipped`, as `runRelease` does (`deliver.ts:913-918`). A `nothing-to-commit` push books no plan, so the step runs over zero plans.

**The shared step lives in a new module with no entry guard (decided).** The step moves out of `runRelease` into a new module, `packages/board/src/server/entry/release-tracker.ts`. `deliver.ts` and `release-finish.ts` both import it, and neither imports the other. `deliver.ts:1021` carries an `import.meta.url` entry guard, and `release-finish.ts` is bundled into `plot-ask.mjs`; importing from `deliver.ts` would run the deliver entry inside `release-approve`. `release-finish.ts:35-36` records the same hazard for `sprint-transition.ts`. The new module carries no guard.

The step takes its `Scripts`, its `PlanStore` and `scriptDir` as parameters, so a test injects fakes; it never constructs `scriptsShell` itself. `FinishContext` gains `scriptDir`, and `main.ts:227` sets it. The step keeps one temp copy of the booked plan per plan, named after the plan, not the single `plot-release-plan-${process.pid}.md` path `deliver.ts:925` uses today, and it runs plans one after another. A finish reads the sibling plans once, from `tmpwt` after the push: every booked plan reads `Released` in that tree, so two booked plans that share an issue do not keep it open, and a Delivered plan outside the booking that names the same issue does keep it open (`skipped another-plan-unfinished`). An unreadable sibling read keeps every issue open, as `runRelease` does.

**A finish refuses another sprint (decided).** The domain's `releaseFinish` refuses `release-scope-mismatch` when exactly one sprint is active and its `Release:` field names a different version than the one being released, before any write. The comparison ignores a leading `v` and reads the field's first version token, so `- **Release:** 2.30.0` matches `v2.30.0`. A sprint with no `Release:` field does not refuse (decided 2026-11-03): `skills/plot/templates/sprint.md` leaves the field commented out, and a project that never fills it in must still release. Such a sprint keeps today's behaviour. The refusal sits after `sprint-ambiguous` and before `plan-unbookable`. `FinishSprint` gains a `release` reading, which `release-finish.ts` reads with `statusField(content, ['Release'])`. An empty active index still answers `already-released`. This closes the path the panel found: once `follow-ups-2-30-1` is active, `release-approve` on the merged v2.30.0 release PR reads `2.30.0` from `package.json` (`release-finish.ts:123-135`), finds the tag, and books the new sprint's Delivered plans as `Released: <date>, v2.30.0`. With the tracker step that would also close their issues.

**No repair through `release-approve` (decided).** A re-run keeps answering `already-released` and writes nothing. The repair route for a missed tracker write is the existing per-plan `plot-deliver.mjs --release <tag> <slug>` (`POST /api/release` where a board runs). Its `case 'released'` arm accepts a Released plan and re-runs the tracker step with nothing to commit. That route repaired all of v2.30.0 on 2026-11-03. Step 5b of `skills/plot-release/SKILL.md` names it.

**Tracker failure (decided).** A tracker outcome never changes the finish's exit code. A pushed booking returns 0. Each plan whose write fails prints one `tracker=failed <issue>` line, and the step continues with the next plan. A `Refused` thrown inside the step for one plan (for example a failed temp copy) counts as that plan's failure and does not reach the finish's `catch` at `release-finish.ts:299-305`, whose text says nothing was pushed. The finish ends with one `summary: issues closed=<N> left-open=<M> (<reasons>)` line, the shape step 5b reads. On a Jira or Bitbucket tracker the per-issue outcome is `no-target` or `unaskable`, and the summary counts it as not closed.

**Reopened issues (decided).** The first-run write closes the issue. No repair re-closes a reopened issue, because no automatic repair exists. The step adds no tracker read before the write: `ports/tracker.ts:261-267` permits only the one read `planStateWrite` documents.

**Plans outside the sprint stay out of scope (decided).** `finishRelease` books only the unstruck Must, Should and Could items of the one active sprint (`release-finish.ts:38-50`, `:206`). A Delivered plan outside the sprint gets no booking and no tracker write. That is #2927 finding 2, tracked in #3069, and this plan does not change it.

The change follows the layering rule: the controller calls the domain for the plan-level decision (`releaseFinish` answers `booked` and the new refusal), the per-issue decisions stay in `rules/issue-status.ts`, and the tracker writes go through the existing Scripts adapter to `plot-issue-status.sh` and `plot-plan-state.sh`.

These decisions were taken by the master agent on the person's standing instruction to keep the fleet moving, after the first panel round (`.plot/panels/2026-11-03-a-release-through-release-approve-leaves/panel.md`).

### Tests

Each new test fails on origin/main before the change.

- **One released write per booked plan.** A finish over three booked plans makes three `plot-plan-state.sh` calls, each `[<copy>, '--phase', 'released', '--plan-link', <rel>, '--version', <tag>, ...]`, whose file argument reads `State: Released`. The count is one call per booked plan, whether or not the plan names an issue; at least one fixture plan carries an `Issue:` line. Today the count is 0.
- **A rejected push makes no tracker call.** A forced rejection prints `tracker=skipped` and calls neither tracker script. A rejected-then-accepted push makes N calls, not 2N.
- **A shared issue stays open through the sibling read.** Booked plans A and B and a plan C left Delivered outside the sprint all name `#999`: A and B are written with `--skip-issue 999`. Without C, no skip flag is passed and the issue closes.
- **A tracker failure continues and prints the line.** The first plan's `plot-plan-state.sh` fails: the finish exits 0, prints `tracker=failed <issue>` for that plan, and still writes the second plan.
- **A scope mismatch refuses before any write.** One active sprint whose `Release:` names a different version: the finish refuses `release-scope-mismatch`, `main` does not move, and no tracker script runs. A domain unit test in `packages/domain/test/workflows-release-finish.test.ts` covers the refusal and its order.

Existing tests:

- Every test in `packages/board/test/unit/release-finish-real-repo.test.ts` stubs `plot-plan-state.sh` and `plot-issue-status.sh` through the scripts port, as `shared-issue-reads-the-post-push-tree.test.ts` does. None reaches a built bundle or a host. Its `sprint()` fixture and `startSprint()` gain a `Release:` line that names the version each test releases.
- `release-finish-real-repo.test.ts:235` keeps its assertions and is restated as "a second run writes nothing": no new commit on `main` and no tracker call.
- `test/reconcile/release-tells-the-tracker.test.mjs`, `packages/board/test/unit/shared-issue-reads-the-post-push-tree.test.ts` and `packages/board/test/unit/deliver-plan-state.test.ts` stay green unchanged. They are the regression guard for the extraction from `runRelease`.

### Documents

- `skills/plot-release/SKILL.md` step 5b and its Model Guidance row: `release-approve` tells the tracker for each plan it books, and `plot-deliver.mjs --release <tag> <slug>` repairs a missed write per plan.
- `CLAUDE.md`, the `release-approve` sentence in *The Master Agent Uses The Controllers*: name the tracker step and the `release-scope-mismatch` refusal, then run `./scripts/check-agents-md.sh --write`.
- Plan #2997 (`docs/plans/2026-11-01-an-issue-shows-its-plan-s.md`): its *What already works* line says release writes `plan:released` (`deliver.ts:969`), which held only for `runRelease`. A line in its `## Notes` records the correction and names this plan.
- A changeset for `plot` with a `plot-release` bump.

## Slices

### Release finish refuses another sprint

- `bug/release-finish-refuses-another-sprint` — `releaseFinish` refuses `release-scope-mismatch` when the one active sprint's `Release:` names a different version than the tag <!-- builds: a release-finish refusal that keeps a re-run off the next sprint --> → #3079

### Tracker step

- `bug/release-approve-tells-its-tracker` — move the tracker step out of `runRelease` into `entry/release-tracker.ts` and call it from `finishRelease` once after the final push <!-- builds: a shared release tracker step used by runRelease and finishRelease --> → #3086

## Notes

- Refs #2907, #2927, #2997, #3069.
- Measured on 2026-11-03 after the hand repair: 25 plans hold `Released: 2026-11-03, v2.30.0` (24 from `7c1317c9e`, one from `c24a65b74`), naming 25 issues; all 25 are CLOSED with `plan:released`.
- Limit: plans outside the active sprint get no booking and no tracker write from `release-approve` (#2927 finding 2, #3069).
- Follow-up, not a slice: `/plot-reconcile` reads only closed issues of Released plans (`rules/released-labels.ts:71`), so an open issue that only Released plans name is invisible to it.

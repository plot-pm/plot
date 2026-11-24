## Implementation brief — a-held-board-shows-the-indexed-tickets

- **Plan (canonical):** docs/plans/2026-11-23-a-held-board-shows-the-indexed-tickets.md on main
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Branch:** `bug/a-held-board-shows-tickets-after-its-first-render` (base: `main`)
- **Ends as:** one PR to `main`, closing #3551
- **Review of the code:** PR, per the plan's `Review: pr`

One slice, no waves. Nothing waits on it and it waits on nothing.

### What to build

#3551 reports a board in `held` mode (a live fleetd on another snapshot protocol, #3528) that shows "the tracker has not been read yet" in the Tickets section while fleetd keeps `.plot/state/index/issues.json` current. Observed 2026-11-19: fleetd on protocol 6, the board on protocol 8, `/api/fleet` answered `issueAnswer: null` with 0 rows.

**The defect is already fixed on `main`.** PR #3552 (merged 2026-11-19, `66507293e`) added `readHeldIssues` (`packages/board/src/server/fleet.ts`, the held branch of `maybeRefreshPrs`), which installs the index through `installIssueIndex` and starts no process. The issue stayed open. What is missing is a test of the order the issue reports. Write one board test that runs it, so the issue closes on evidence.

The sequence the test runs, on a held board:

1. `buildFleet` (first render). It reaches `fleetPlanIndexOf`, which runs `planMetasAtDefault` and sets `entry.planMetas`. On a held board this is the only code that fills `planMetas`.
2. `maybeRefreshPrs` (the held PR beat). It calls `readHeldIssues`, which filters planned issues through `entry.planMetas`.
3. `buildFleet` again. Assert the second `/api/fleet` body.

Assert on the second body: `issueAnswer: 'answered'`, `issueError: null`, and the unplanned row only. Fixture: snapshot link `mismatch`, a live fleetd heartbeat, an `issues.json` with two rows, and one plan on the default branch that names one of them.

Put the test in `packages/board/test/unit/board-serves-the-snapshot.test.ts`, in the `describe('the PR beat on held, with an issue index to serve', …)` block (line ~403), next to `heldFixture`. Reuse `heldFixture`'s index and link; add a heartbeat the way the neighbouring tests do (`adapters.fleetdHeartbeatIn(...).write(heartbeat(...))`). The plan file must exist where `planMetasAtDefault` reads it: either a repo with `origin/<default>` holding the plan, or the working-tree fallback (`planMetasFromWorkingTree`) when `origin/<default>` does not resolve. Take whichever the file's `fixture()` already gives you (line 209) and say which in a comment.

**If the second render answers `null` or `failed`, the test found the bug.** Then the slice fixes the order in the board's server layer (`fleet.ts`, where `readHeldIssues` lives). No domain or port change is expected. If the test passes on the first run, no production code changes and the PR is test-only.

### Decisions the plan settles — do not re-derive them

**The test calls the render twice; the existing tests set `entry.planMetas` by hand or leave it null.** That is the gap. Do not copy the neighbouring test's `entry.planMetas = [PlanMetaSchema.parse(…)]` line: a hand-set `planMetas` is exactly what hides a regression in the render-then-beat order. A test that sets it passes with #3551's bug present.

**Assert `issueAnswer`, not a browser.** The Tickets wording comes from `delivery-view.ts` and `section-empty.ts` over `issueAnswer`, so the state is a domain property and a unit-level assertion proves it (CLAUDE.md, *Every rendered state is a domain property*). No Playwright test, and none of the 42-of-43 board-server tests.

**Do not assert "0 processes" on this path.** The neighbouring tests count spawns with `counted.calls` and expect `[]`. This test cannot: on a held board `fleetPlanIndexOf` runs `planMetasAtDefault`, which reads refs through `git` and parses plans through `plot-plan-meta.sh`, so the render starts processes. The plan leaves this out on purpose (open question `question-render-starts-processes`: file a separate issue with a process count from a held render if you want it fixed). Asserting `[]` here fails for a reason that has nothing to do with #3551; asserting a process count belongs to that other issue.

**A cold held board answers `failed`, and that stays.** A held board that has not rendered once answers `failed` with "no plan read has answered while fleetd speaks another snapshot protocol" (`question-cold-held-board`, accepted). The existing second test at line ~432 already holds it. Do not change it and do not add a cold-board assertion to the new test.

**Absent is not false.** An unplanned row is one the plans do not name, read from a plan read that answered. A `null` plan read must never turn into "no plan names this issue". The test must therefore prove the plan read answered (the planned row is absent from the result) and not only that the unplanned row is present: a broken plan read that returns every row would pass an assertion on the unplanned row alone.

**Arrow functions.** Any helper you write in the test file is an arrow (`const f = (…) => …`), per CLAUDE.md. Leave the neighbouring declarations alone.

### Done when

The plan's slice line is the specification: the test runs render, held PR beat, render, and asserts the second `/api/fleet` body carries the unplanned index row with `issueAnswer: 'answered'`. The assertions that exist because a naive test would pass without them:

- **`entry.planMetas` is null before the first render and non-null after it.** Assert both. It proves the first `buildFleet` filled it, not the fixture.
- **The second body lists only the row no plan names, and the planned row is absent.** Catches a plan read that answers every row unplanned.
- **`issueAnswer` is `'answered'` and `issueError` is `null`.** Catches the `failed` path of #3551.
- **Revert check.** Before you push, break the order once (for example make `readHeldIssues` pass `null` for `plans`, or call `maybeRefreshPrs` before the first `buildFleet`) and confirm the new test fails with the issue's symptom. A test never seen failing proves nothing. Restore from git, not from memory.

Plus: run `nvm use` (Node 26, per `.nvmrc`), then `node skills/plot/scripts/board/plot-local-checks.mjs` after each commit and before each push, and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite and no `pnpm run test:e2e`. Do not run board tests while an operator's board is open on this machine. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. Commit no board bundle.

If the slice changes only a test, no changeset is needed. If it changes production code in `fleet.ts`, add a changeset naming `@plot-pm/board` with the description first, no `bumps:` block, and the `plan:` line inside the trailing comment; copy the format of a recent file in `.changeset/`.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh`, never `gh pr create`. The PR body names #3551 and links #3552, so the issue closes on merge. Then append `→ #<number>` to this slice's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/test/unit/board-serves-the-snapshot.test.ts` and, only if the test fails, the held path of `packages/board/src/server/fleet.ts` (`readHeldIssues`, `fleetPlanIndexOf`, the held arm of `maybeRefreshPrs`). It touches no domain file, no port, no plan format and no script. No other slice of this plan is in flight; check `git status` and open PRs on `fleet.ts` before you edit it, since that file is large and other branches touch it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

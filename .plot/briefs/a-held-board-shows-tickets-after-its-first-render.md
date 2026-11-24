## Implementation brief — a-held-board-shows-the-indexed-tickets (Proof)

- **Plan (canonical):** docs/plans/2026-11-23-a-held-board-shows-the-indexed-tickets.md on main
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Branch:** `bug/a-held-board-shows-tickets-after-its-first-render` (base: `main`)
- **Ends as:** one PR to `main` that closes #3551 and links #3552
- **Review of the code:** the PR review channel (`Review: pr`)

The plan has one slice. Nothing waits on it and it waits on nothing.

### What to build

One board test that runs the sequence #3551 reports and asserts the second `/api/fleet` body. The defect is fixed on `main`: #3552 (commit `66507293e`) added `readHeldIssues` (`packages/board/src/server/fleet.ts`, near line 2707), which the held PR beat calls in `maybeRefreshPrs` (near line 3189). It reads `.plot/state/index/issues.json` through `installIssueIndex` and starts no process. #3551 stays open because no test covers the order that matters: `readHeldIssues` filters planned issues through `entry.planMetas`, and on a held board only a `/api/fleet` render fills that field, through `fleetPlanIndexOf` (near line 1878, called from `buildFleet` near line 8902). Observed 2026-11-19: fleetd on snapshot protocol 6, board on 8, `/api/fleet` answered `issueAnswer: null` with 0 rows.

The test builds a held board, calls `buildFleet`, then `maybeRefreshPrs`, then `buildFleet` again. The second body must carry `issueAnswer: 'answered'`, `issueError: null`, and only the row no plan names. Put it in `packages/board/test/unit/board-serves-the-snapshot.test.ts`, next to the `describe('the PR beat on held, with an issue index to serve')` block (`heldFixture`, near line 403), and reuse that fixture: snapshot link `mismatch`, live fleetd heartbeat, an `issues.json` with two rows. Add one plan on the default branch that names one of the rows, so the render can fill `planMetas` itself.

### Decisions the plan settles — do not re-derive them

**The existing tests do not cover this path.** They set `entry.planMetas` by hand (`[PlanMetaSchema.parse({...})]`) or leave it null and expect `failed`. Setting it by hand is exactly what hides a regression in the render-before-beat order. Your test must let `buildFleet` fill `planMetas`, never assign it.

**Assert the domain value, not a browser.** The Tickets wording comes from `delivery-view.ts` and `section-empty.ts` over `issueAnswer`. Assert `issueAnswer`, `issueError` and the rows in the `/api/fleet` body. A browser test rejected: it would start a full board server to see a value the unit test reads directly.

**A failing test is the bug.** If the second render answers `null` or `failed`, fix the order in `fleet.ts`, where `readHeldIssues` already lives. No domain or port change is expected. If the test passes on first run, no production change belongs in this PR.

**Out of scope, decided in the plan:**

- `[question-render-starts-processes]`: on a held board, `fleetPlanIndexOf` runs `planMetasAtDefault`, which reads refs through `git` and `plot-plan-meta.sh`. Leave it. File a separate issue with a process count from a held render. Do not assert `counted.calls` empty in the new test, because `buildFleet` starts processes here.
- `[question-cold-held-board]`: a held board that has not rendered once answers `failed` with "no plan read has answered while fleetd speaks another snapshot protocol". Accepted. The existing test already holds it.

**Rules carried over:** absent is not false (a missing index means ask, never "no tickets"); read exit codes, not emptiness; a function you write is an arrow, including a test helper.

### Done when

The plan's slice line is the specification: a board test runs render, held PR beat, render, and asserts the second `/api/fleet` body carries the unplanned index row with `issueAnswer: 'answered'`; the PR closes #3551. Two assertions a naive test would pass without:

- `issueAnswer === 'answered'` and `issueError === null` together. A test that checks only the row count passes where the answer is `failed` with a stale row.
- Only the row no plan names is unplanned. Without the plan fixture, both rows read unplanned and the test cannot tell a filled `planMetas` from a null one.

Plus: no changeset is needed if the PR changes only test files; add one (`plot` or `@plot-pm/board`, description first, `bumps:` last) if `fleet.ts` changes. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows; this slice touches no `.sh` file.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. The PR body names #3551 and links #3552. Append `→ #<number>` to this branch's line in the plan's `## Slices` section when the PR exists. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/test/unit/board-serves-the-snapshot.test.ts` and, only if the test fails, `packages/board/src/server/fleet.ts`. No other plan branch is in flight on those files (`origin` carries only `sprint/plot-describes-itself` besides `main`, checked at dispatch). If you find something the plan did not anticipate, report it rather than improvising outside scope.

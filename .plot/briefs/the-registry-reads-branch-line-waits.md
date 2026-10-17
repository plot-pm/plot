## Implementation brief — a-fresh-agent-after-a-wait (wave 1: Registry waits)

- **Plan (canonical):** `docs/plans/2026-10-17-a-fresh-agent-after-a-wait.md` on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1954 merged
- **Branch:** `bug/the-registry-reads-branch-line-waits` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per the plan's `Review: pr` answer; issue #1273 (grouped by #1950)

This wave blocks nothing by file, but the plan's waves land in document order: `bug/a-free-desk-ending-acts-on-no-slice` (wave 2) and `bug/fleetd-at-agents-zero-after-a-wait` (wave 3) wait on it.

### What to build

Measured 2026-10-04: `plot-registryd` handed `infra/the-loop-has-a-workflow` to an agent while the branch its `waits:` names (`infra/the-shell-loop-holds-unlanded-work`, #1271) was open and failing. On current `origin/main` the chain reads that line correctly: `plot-plan-meta.sh` on `2026-10-04-the-worker-loop-runs-in-js.md` returns `waits_on: ["infra/the-shell-loop-holds-unlanded-work"]`, the plan-store adapter maps it, and `planQueue` holds on it. So this slice is measure-first. Write two regression tests that pin the chain, run them on `origin/main`, and let the result decide whether any rule changes.

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

- **The tests come first and decide the fix.** If both pass on `origin/main`, the slice ships the tests, records the cause in the PR as the stale daemon, and changes no rule. If one fails, the fix goes where it fails: the adapter mapping (`packages/domain/src/adapters/plan-store/plan-store-shell.ts`, `branchOf`), or the `merged` set `planQueue` receives (merge-subject fallback, `listingWhole`). The plan names the adapter at `plan-store-shell.ts:69-80` under `packages/fleet`; the file lives under `packages/domain/src/adapters/plan-store/`, so use that path.
- **Stale daemon is the leading cause, not a settled one.** `registryd.log:30654` started the daemon that made both hand-overs (2026-10-04 23:04, 2026-10-05 08:19), and it did not restart between them. #1247 and #1253 (2026-10-03) and #1265 (2026-10-04 00:15) added the `waits:` reading within a day before. None of that daemon's tick lines carries a `waits=` counter; one first appears at `:69362` after the restart as `plot-fleetd`. A wrong `merged` set is the second candidate. The tests exclude or confirm it; do not assert a cause the tests do not show.
- **The fixture is a markdown plan, not a hand-built `PlanRecord`.** The existing `a \`waits:\` prerequisite holds a slice through the real join` block (`queue-reading.test.ts:723`) builds a `PlanRecord` directly, which is why it never exercised the parser. The new test drives a markdown fixture whose bullet carries a `builds:` marker followed by a `waits:` marker through `plot-plan-meta.sh` → plan-store adapter → `planQueue` → `whyNotReady`.
- **Absent is not false.** A missing or unparseable `waits:` yields an empty list, not a reading that the prerequisite merged. Keep that distinction in any fix.
- **No new ranking or hold rule.** If a rule must change, change the one that fails; do not add a second place that reads `waits`.

### Done when

The plan's slice line is the specification:

- A test in `packages/fleet/test/unit/queue-reading.test.ts` named *a branch-line `waits:` holds the slice through the parser* asserts `whyNotReady(...) === 'waits'` for a markdown fixture whose bullet carries a `builds:` marker followed by a `waits:` marker.
- A second test asserts `not-claimable` for slice 2 of the same plan while slice 1 is unmerged and unclaimed.
- The PR description names the cause the tests found. A rule changes only where a test fails on `origin/main`.

Assertions that exist because a naive implementation passes without them:

- **The fixture goes through the parser.** A `PlanRecord` built by hand passes today and proves nothing about `plot-plan-meta.sh`; the existing block at line 723 is that shape.
- **The marker order is `builds:` then `waits:` on one bullet line.** A fixture with only `waits:` skips the case #1273 measured.
- **Slice 2 reads `not-claimable`, not `no-brief`.** The two are different holds; a `merged` set that wrongly names the prerequisite would show here as the wrong reason.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally. New test helpers are arrow functions. Add a changeset: description first, the `bumps:` block last, the `plan:` line inside the comment block and never first. A PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`). If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` requires an equal number of shell lines removed in the same change; this slice should touch none.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section, and set the PR to "Ready" if a project board is configured. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/fleet/test/unit/queue-reading.test.ts` and, only if a test fails on `origin/main`, the file where it fails: `packages/domain/src/adapters/plan-store/plan-store-shell.ts` or `packages/domain/src/rules/queue.ts` and its tests. It does not touch `ending-action.ts`, `agent-loop.ts`, `registryd.ts` or `scaleUp` — those are waves 2 and 3. Other branches in flight on `origin` at dispatch: `bug/jenkins-runs-history`, `feature/bitbucket-pr-state-binds-checks`, `bug/plot-review-one-issue-per-pr`, `bug/ready-line-after-every-bind`, `feature/a-merged-pending-check-is-asked-again`; none is named for the queue reading or the plan-store adapter, but check `git diff origin/main...origin/<branch> --stat` before editing a shared file.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

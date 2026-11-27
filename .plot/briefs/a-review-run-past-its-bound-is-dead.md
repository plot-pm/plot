## Implementation brief — a-stale-pending-review-is-asked-again (wave 1: Bounded Run)

- **Plan (canonical):** [docs/plans/2026-11-27-a-stale-pending-review-is-asked-again.md](../../docs/plans/2026-11-27-a-stale-pending-review-is-asked-again.md) on `main`
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Branch:** `bug/a-review-run-past-its-bound-is-dead` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` status on the head (the ruleset requires it since 2026-10-15)

This is wave 1 and waits on nothing. `bug/a-held-stale-review-names-its-reason` (wave 2, Held Reason) waits on this branch: it logs the reason a stale pending is held, and that reason set is only complete once this branch has removed the unbounded `review-in-flight` hold.

### What to build

On #3658 (`bug/the-spike-card-names-its-reason`), `plot/review` on head `9d7846ec8` read `pending` from 12:51:05 UTC on 2026-11-22 and wrote no result. The PR waited 9 h 11 min until a person ran `plot-review.mjs` by hand; that run finished in under 3 min. The stale-pending rule already exists: `reviewArm` (`packages/domain/src/rules/slice-pr-next.ts`) asks a new review where a trusted `pending` on the head is older than `config.reviewBoundMs`, and `readReviewPass` sets that to `REVIEW_BOUND_MS` (3600 s, `packages/fleet/src/shared/auto-review.ts:71`). So the arm was held before it ran. Two paths hold a review with no age bound, and either one makes `reviewRunArm` answer `review-in-flight` for as long as a process exists, so `reviewArm` is never asked:

1. `reviewRunLive(entry, pidAlive, now)` (`packages/domain/src/rules/review-run.ts:42`) answers `pidAlive || now - startedAt < REVIEW_START_GRACE_MS`. A hung `plot-review.mjs` whose pid answers is live at any age.
2. `reviewTick` (`auto-review.ts:134-139`) builds a live run from a lock holder with `startedAt: readings.now` on every pass, so a lock whose holder hangs is always "just started".

The change bounds both and ends the run that exceeded the bound:

- `reviewRunLive(entry, pidAlive, now, boundMs)` answers live only while `now - entry.startedAt < boundMs + REVIEW_START_GRACE_MS`. Past it the run is dead whatever its pid answers. Every caller passes the bound: `liveReviewRuns` and `readReviewRuns` in `packages/domain/src/adapters/review-start/review-start-node.ts` (lines 81, 96), `roleRuns` in `packages/domain/src/rules/agent-roles.ts:96`, and `reviewTick`. The slice-PR pass passes `REVIEW_BOUND_MS`. Decide whether `boundMs` is a required parameter: a required one makes the compiler find every caller, which is the point.
- The lock-holder path reads the lock file's creation time and passes it as `startedAt`. Add the read beside `reviewLockPath` / `reviewLockPid`, through `ReviewPassWorld` (`readLock` returns text only today, so the world needs a way to answer the lock's time that a test can replace). A lock whose time cannot be read counts as started at the first pass that saw it, held in the pass's memory (a `Map` keyed by PR and head that lives as long as the pass loop does), never `now` on every pass.
- Where the bound has passed and the pid still answers, the pass ends that process before it starts a review and logs `plot-review: run <pid> on PR #<n> passed the <s>s bound; ended` to `slice-review.log`. Ending needs a new method on the review-start adapter (`adapters/review-start/`); the `Detached` port has no kill, and a controller or rule must not call `process.kill` itself (the layering rule, and the CI spawn ratchet counts `spawn`/`execFile`). `desk-monitors-shell.ts:53` and `run-script.ts:84-94` show the SIGTERM-then-SIGKILL shape already used in the adapters. Name the process by pid only after the entry's `startedAt` or the lock's time proves it is past the bound, so a recycled pid is not ended.
- The new review counts against the head's start budget (`REVIEW_START_BUDGET` 3, `rules/review-run.ts:28`) like any start, so a head that keeps hanging stops after its budget with `budget-spent`.

The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**The bound is `REVIEW_BOUND_MS`, not `Checks wait`.** Both read 3600 s here, and the plan chose the review's own run bound, because `plot-review.mjs` stops itself at that bound and the bound therefore says when a run is dead. `Checks wait` answers how long CI may take.

**A run past the bound is ended, not orphaned.** The alternative (count the run dead and start a second review beside the first) leaves two reviews of one head. That is the corruption the review run lock exists to prevent: the second run deletes the first run's verdict and diff files, and the status write is last-writer-wins. `plot-review.mjs` already stops itself at the same bound, so a process still alive past it is not writing a result. Ending it first is safe.

**Do not rebuild `reviewArm`.** It already asks a new review for a stale trusted `pending` (since `69252a90c`, 2026-10-30), and `reviewReaskPrNumbers` (`rules/pr-index.ts:372`) re-asks a pending row each pass. The defect is upstream of both. Reading them as the bug repeats what the plan already measured.

**The fleet's records from 2026-11-22 are gone.** `.plot/state/review-starts.json` holds no row for #3658, so which hold applied is not readable from the machine. The plan names two unbounded paths from the code, not from a log. Do not spend the branch looking for the original log, and say in the PR that the two paths are the cause by construction, not by recorded observation.

**Carried over unchanged:** absent is not false (a lock whose time is unreadable is a lock seen, not a lock absent); read the exit code, not the emptiness; the index never says "no review", and the PR index's `plotReview*` fields stay as the arm reads them. The `review-in-flight` hold's grace window (`REVIEW_START_GRACE_MS`, 30 s) stays and is added to the bound, not replaced by it.

### Done when

The plan's slice `tests:` line is the specification:

- An entry with a live pid started 3601 s ago reads not live. Assert at the edge as well: 3600 s plus the 30 s grace still reads live, one millisecond past reads dead. A naive `now - startedAt < boundMs` passes the first assertion and drops the grace.
- A lock first seen 3601 s ago yields no `review-in-flight` hold. Assert this with a lock whose time is unreadable and a pass that saw it 3601 s ago, so the in-memory first-seen path is exercised, not only the file-time path. A pass that substitutes `now` each time passes every single-pass test and fails only this one.
- The #3658 fixture: `pending` on the head for 9 h with a live pid starts exactly one review, and a second pass on the same state starts none (the new run is live). A one-pass assertion hides a start per tick.
- A fourth start on the same head answers `budget-spent`.
- The ended process: assert the adapter's end method is called once, with the pid, and not at all for a run inside the bound. A test that only checks "a review started" passes without any process being ended.
- Every existing caller of `reviewRunLive` compiles and its tests pass (`agent-roles.test.ts` at `:67` builds an entry from `REVIEW_START_GRACE_MS`; update it to the new signature, do not loosen it).

Plus the repo's gates: no committed bundle diff (`scripts/check-no-bundle-diff.sh`), and a changeset in `.changeset/` for `plot` with the description first and the `bumps:` block last. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in `CI suites` run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally. This change is TypeScript only: no `.sh` file should change, so `scripts/check-shell-lines.sh` has nothing to count. If one does change, pay for the growth in the same change.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

When the PR exists, append `→ #<number>` to this branch's line under `### Bounded Run` in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/domain/src/rules/review-run.ts`, `packages/domain/src/adapters/review-start/`, the `reviewRunLive` call in `packages/domain/src/rules/agent-roles.ts`, `packages/fleet/src/shared/auto-review.ts` (the lock-holder path, the end call and its log line), and the tests of each. It does not own `slice-pr-next.ts`'s arms: do not change `reviewArm` or `reviewRunArm`. It does not write the held-reason line; that is `bug/a-held-stale-review-names-its-reason`, which waits on this branch and edits the same pass in `auto-review.ts`. Keep this branch's log line limited to the `ended` message so the two do not collide. Other recent briefs name these files (`the-release-review-is-switched-on`, `the-review-reads-the-fixer-scope`, `the-fixer-scope-reads-every-open-pr`); those slices were briefed earlier, so rebase on `origin/main` before the PR and read the conflicts in `auto-review.ts` rather than taking either side.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

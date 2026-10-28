# Parallel release calls exhaust their push retries

> 53 back-to-back `POST /api/release` calls started 53 parallel jobs that all push to `main`. 24 jobs stopped after 5 non-fast-forward rejections. The plan makes a release sweep over N plans record all N plans.

## Status

- **State:** Draft
- **Type:** bug
- **Story:**
- **Sprint:**
- **Issue:** #2804
- **Review:** pr
- **Impl:** own branches

## Changelog

- A release sweep over N plans marks all N plans `Released`, whatever the order or timing of the calls.

## Motivation

On 2026-10-28 the v2.29.0 release record ran as 53 `POST /api/release` calls sent back to back (#2804). The board starts one background job per call, so the jobs ran in parallel, and each job pushes its plan record to `main`.

- 24 of 53 jobs logged `error: failed to push some refs` and stopped after attempt 5 of 5 with `non-fast-forward`.
- 11 plans reached `State: Released` in the first pass.
- Re-running the remaining plans one at a time released all of them.

`plot-push-main.sh` takes a push lock (`plot-push-lock.mjs`). The lock serialises the push, and 5 retries do not cover a queue of about 50 writers. The same shape appeared on 2026-10-07 with a 4-plan `/api/release` batch (4 of 4 `push=rejected`), which the lock was added to fix. The lock fixed 4 writers and not 53.

Two contributing facts from the issue:

- `/plot-release` step 5b tells the cutter to make one call per plan and does not say to wait between calls.
- The endpoint answers 202 before its job ends. `releaseStatus` (`packages/board/src/server/release.ts`) reads a job's state back per slug, but the step 5b text does not tell the caller to poll it.

## Design

### Approach

Open points below decide the mechanism. The candidates:

1. **Serialise in the board.** `POST /api/release` queues its job behind the jobs already running, so at most one release job pushes at a time. The caller sends N calls and the board orders them. A sweep then needs no caller discipline.
2. **Raise the retry budget.** The push retry loop waits for the lock longer or retries more than 5 times. This is the smallest change and scales with the queue length, not with the cause.
3. **Batch the push.** One job records several plans in one commit and one push. This removes the contention and changes the one-call-per-plan contract of the controller.
4. **Document the wait.** Step 5b tells the cutter to poll `releaseStatus` between calls. This is a rule, and `CLAUDE.md` (*Gates Over Rules*) names a rule as the weaker form.

Recommended starting point: candidate 1, with a test that sends 53 calls and expects 53 `Released` plans. Candidate 4 follows as a one-line step 5b edit that names the queue.

### Open Points

- [ ] Which candidate? The reader decides before approval.
- [ ] Does a queued job keep the existing `releaseStatus` states (`running`, `done`, `failed`, `unknown`), or does a waiting job need a `queued` state?
- [ ] Should the same queue cover `POST /api/approve`, which the 2026-10-07 measurement in `plot-push-lock.mjs` shows has the same failure?
- [ ] Is the 120 s `PLOT_PUSH_LOCK_WAIT` the right bound for a 53-job queue, or does it expire for the jobs at the back?

## Slices

- `bug/parallel-release-calls-exhaust-their-push` — a release sweep of N back-to-back calls records N plans; regression test with a sweep larger than the retry count

## Notes

- Created from tracker issue #2804. The plan writes nothing to the tracker.
- Board impact: yes, if candidate 1 or 3 is chosen (`packages/board/src/server/release.ts`).

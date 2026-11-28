# A stale pending review is asked again

> A review run that holds a PR's head counts as in flight only within the review's own bound, so a `pending` `plot/review` with no result behind it starts one new review, and the review pass names the reason when it holds a stale pending.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** fleet-runs-safely-alone
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Started:** 2026-11-27, Jan Wloka, `bug/a-review-run-past-its-bound-is-dead`
- **Started:** 2026-11-27, Jan Wloka, `bug/a-held-stale-review-names-its-reason`

## Changelog

- A `plot/review` that stays `pending` past the review's bound of 3600 s no longer holds its PR: the fleet starts one new review on that head. While it still holds a stale pending, the review log names why.

<!-- Board impact: none. The change is in the review pass's readings and its log line. -->

## Motivation

On #3658 (`bug/the-spike-card-names-its-reason`), `plot/review` on head `9d7846ec8` read `pending` from 12:51:05 UTC on 2026-11-22 (run `e1ae2757-f04c-4d76-a685-726089ddb677`) and wrote no result. A person ran `plot-review.mjs` again: a second `pending` at 21:59:36 (run `f898dddd-b658-43c2-ad48-81621f72d468`) and `success` at 22:02:10. The PR waited 9 h 11 min for a review that ended in under 3 min once it started.

The stale-pending rule exists. `reviewArm` (`packages/domain/src/rules/slice-pr-next.ts:446`, since `69252a90c`, 2026-10-30) asks a new review where a trusted `pending` on the head is older than `reviewBoundMs`, which the slice-PR pass sets to `REVIEW_BOUND_MS`, 3600 s (`packages/fleet/src/shared/auto-review.ts:71`, "`plot-review`'s own bound of 3600 s"). `reviewReaskPrNumbers` (`packages/domain/src/rules/pr-index.ts:372`) re-asks a pending row each pass. So the arm was held before it ran, or never reached.

The fleet's records from 2026-11-22 do not survive: `.plot/state/review-starts.json` holds no row for #3658, so which hold applied is not readable. Two paths in the code hold a review with no age bound. `reviewRunLive` (`packages/domain/src/rules/review-run.ts:42`) counts an entry live while its pid answers, at any age. The lock-holder path (`auto-review.ts:134-139`) builds a live run with `startedAt: readings.now` on every pass. Either one makes `reviewRunArm` answer `review-in-flight` for as long as the process exists, and `reviewArm` is never asked.

## Design

### Approach

- **A live run has a bound.** `reviewRunLive(entry, pidAlive, now, boundMs)` answers live only while `now - entry.startedAt` is below `boundMs` plus `REVIEW_START_GRACE_MS`. Past it, the run counts as dead whatever its pid answers. The slice-PR pass passes `REVIEW_BOUND_MS`.
- **A lock carries its own start.** The lock-holder path reads the lock's creation time and passes it as `startedAt`, so the same bound applies to a run known only by its lock. A lock whose time is unread counts as started at the first pass that saw it, held in the pass's memory, never as `now` on every pass.
- **A dead run is stopped before a new one starts.** Where the bound has passed and the pid still answers, the pass ends that process through the review-start adapter (`adapters/review-start/`) before it starts a review, and logs `plot-review: run <pid> on PR #<n> passed the <s>s bound; ended`. The new review then counts against the head's start budget (`REVIEW_START_BUDGET` 3, `rules/review-run.ts:28`), so a head that keeps hanging stops after its budget.
- **A held stale pending names its reason.** Where a trusted `pending` on the head is older than the bound and the pass still does not start a review, the pass writes one line per PR per head to `.plot/state/slice-review.log`: `plot-review: PR #<n> pending since <time>; held: <reason>`, with the arm's `none` or `hold` reason (`out-of-scope`, `budget-spent`, `backoff`, `review-in-flight`). The next occurrence is then readable.

### Open Questions

- [ ] `[question-bound-value]` Recommendation: `REVIEW_BOUND_MS`, the review's own run bound, and not `Checks wait`; both read 3600 s here, and the review's bound is the one that says when a run is dead.
- [ ] `[question-end-or-orphan]` Ending a run past its bound may cut a review that was about to write. Recommendation: end it; `plot-review.mjs` already stops itself at the same bound, so a run past it is not writing a result.

## Slices

### Bounded Run

- `bug/a-review-run-past-its-bound-is-dead` — `reviewRunLive` takes the bound, the lock-holder path carries the lock's start, and the pass ends a run past the bound before it starts one <!-- builds: the bounded reviewRunLive --> <!-- tests: an entry with a live pid started 3601 s ago reads not live; a lock first seen 3601 s ago yields no review-in-flight hold; the #3658 fixture — pending on the head for 9 h with a live pid — starts exactly one review; a fourth start on the same head answers budget-spent --> → #3748

### Held Reason

- `bug/a-held-stale-review-names-its-reason` — the review pass logs one line per PR and head where a stale pending is not re-asked <!-- waits: bug/a-review-run-past-its-bound-is-dead --> <!-- builds: the stale-pending reason line --> <!-- tests: a stale pending out of scope writes one line naming out-of-scope; a second pass on the same head writes no second line; a pending under the bound writes nothing --> → #3760

## Notes

Created on 2026-11-27 for the sprint fleet-runs-safely-alone.

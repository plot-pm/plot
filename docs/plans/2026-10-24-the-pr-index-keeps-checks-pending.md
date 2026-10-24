# The PR index keeps checks pending after they finish

> A PR whose checks finished stays `pending` in the PR index, so the board shows "CI running" and `awaitsMarkReady` never fires for a green draft.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2560
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2570 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/the-pr-index-keeps-checks-pending`

## Changelog

- The board shows a PR under *Waiting on you* with "mark ready" once its checks finish green, instead of keeping it under *Waiting on a machine* with "CI running".

<!-- Board impact: the PR index feeds the board's rows. The fix is in packages/fleet; no plan format, template or helper script changes. -->

## Motivation

Measured 2026-10-24 on PR #2550 (issue #2560):

- All four checks passed; the last finished at 13:37:20Z (`gh pr checks 2550`).
- `.git/.plot/state/index/github.json` at `at` 14:08:29Z, watermark 14:00:20Z, `complete: true`, still held `{"number":2550,"checks":"pending","draft":true,"updatedAt":"2026-10-24T13:19:13Z","checksSha":"b4d003b51…"}`.
- The PR's `updatedAt` stayed 13:19:13Z: a finished check run does not change a PR's `updatedAt` on GitHub.
- The last whole refresh (`wholeAt`) was 2026-10-23T16:53:55Z, 21 hours earlier.

The row stays under *Waiting on a machine* and `awaitsMarkReady` never fires, so a green draft with no live agent waits for a person who is never told.

## Design

### Approach

The issue names the cause as: the incremental refresh re-reads only PRs updated since the watermark, so a PR whose checks finish without a push or edit is never re-read.

**That cause is incomplete.** `packages/fleet/src/shared/pr-refresh.ts` already re-asks stored `OPEN` + `pending` rows on every delta (#1277, `pendingOpenPrNumbers`, the block after the primary `pr-list` call). The re-ask is bounded: `PR_PENDING_REASK_LIMIT = 5` consecutive no-progress answers, then one ask per `PR_PENDING_REASK_SLOW_MS` (300 s) while the head is younger than `Checks wait`, then none. The streak and last-ask time live in memory on the refresh entry.

So the first slice reproduces the stuck row and finds which of these holds, before any change:

1. The re-ask never fires for this row (for example the stored row is not matched by `pendingOpenPrNumbers`, or the `pr-list --rich --state open` answer is dropped).
2. The re-ask fires and the host answers `pending` while `gh pr checks` answers `pass` (for example a different checks source, or `checksSha` bound to an older head).
3. The bound is spent: the streak reached the limit and the 300 s slow path or the `Checks wait` window stopped the asks.
4. The delta does not run at all (cadence, backoff, or no fleetd).

The fix follows the finding. The expected behaviour stays as the issue states: a row whose checks read `pending` is re-asked on the incremental refresh, whatever its `updatedAt`, until its checks settle.

### Open Questions

- [ ] Which of the four causes above holds for PR #2550? The answer decides the fix; the reproduction is the first slice.
- [ ] If the bound is the cause: should a `pending` row whose head is older than `Checks wait` still be re-asked at a slower cadence, or is a whole refresh the right backstop?
- [ ] Should a whole refresh be forced when any stored `OPEN` row has been `pending` for longer than `Checks wait`?

## Slices

### Reproduce and fix

- `bug/the-pr-index-keeps-checks-pending` — reproduce the stuck `pending` row in a test over `refreshPrs` with a held store (no I/O), identify which cause holds, and fix it so the row settles on the next incremental refresh → #2586

## Notes

- Related: #1277 (the pending-check re-ask), `a-merged-pr-s-checks-freeze` (2026-10-09).
- Created unattended from issue #2560 with no Design answer in the prompt, so the plan starts in Draft.

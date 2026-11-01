# An issue shows its plan's state on every surface

> An issue's tracker state (lane, label, open/closed) should track its plan's lifecycle state everywhere the issue is read, not only where a writer already exists.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2997
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- An issue tracks its plan's state everywhere it is read: the Stories lane reflects the default branch's plan set (not the local checkout), a released plan's issue always carries `plan:released`, and a review-finding ticket closes (or says why not) once its PR merges and its findings are settled.
- A slice row shows the CI state of its PR's current head: after a new push, the row leaves *Waiting on you* within one PR index refresh instead of keeping the old head's failing checks.

<!-- Board impact: yes. Gap 1 touches packages/board/src/server/fleet.ts (referencedIssues) and packages/domain/src/rules/ticket-lanes.ts. Gaps 2-4 are tracker-write concerns under skills/plot/scripts and packages/fleet/src. -->

## Motivation

A plan's issue does not always show the plan's state. Five gaps were measured on 2026-11-01, each naming the code that reads or writes the state:

1. **The Stories lanes read plans from the local checkout, not `origin/main`.** `ticketLanes` (`packages/domain/src/rules/ticket-lanes.ts:149`) puts an open issue in *In progress* when a plan names it. The named-issue set comes from `referencedIssues` (`packages/board/src/server/fleet.ts:1558`), which reads `docs/plans/` in the main checkout's working tree. When a plan PR merges, the plan leaves the idea branch and lands on `origin/main` — until someone moves the main checkout, no plan names the issue there, and the issue falls back to *Open*. Measured: #2993 (plan PR #2994 merged, slice PR #2996 open) showed *Open* on the Stories tab while #2980 showed *In progress*; the plan cards and Delivery tab showed both as in-progress because the plan walk reads `origin/main` directly. The main checkout was 10 commits behind at the time. Fix direction named in the issue: the named-issue set should read the same plan set as the plan walk (plan `the-plan-walk-moves-into-the`, #2981, already approved and in progress as of this writing).

2. **Released plans leave 38 closed issues with no `plan:released` label.** Those plans were released before the release write existed, or outside `/plot-release`. Nothing backfills the label, so the board and a human reader of the issue see a phase older than the plan's.

3. **Review finding tickets stay open after their findings are settled.** `plot-review` opens one ticket per reviewed PR with findings (for example #2918, #2920). Nothing closes a ticket when its findings are fixed, or says why it stays open when they are not. #2920 was closed by hand on 2026-11-01 after a triage found every finding fixed.

4. **The plan-state comment write has two known defects**, already filed as review findings and already on the sprint as the plan-comment item: `withIssueLock` can delete another writer's lock and a failed `issue-comment-read` can erase the comment's ticket and progress lines (#2935); the marked-comment lookup matches only the current login, so a second account posts a second plan comment, and a Delivered or Released write with no pulse can drop the progress line (#2924). This plan does not re-design the fix — it tracks the two tickets as the gap's acceptance, since #2935 and #2924 already own the design.

5. **A slice row keeps the old head's failing checks after a new push.** Slice `feature/a-plan-reference-is-decided-once` (PR #2996) failed CI on head `dc98f4a02` at 12:44 UTC on 2026-11-01. The desk pushed `75da18f94` at 13:03, and CI started on the new head. The PR index row read `pending` at 13:02:59, but the Delivery row still read *Waiting on you*, "PR #2996, checks failing", until about 13:10, when it moved to *Working*. The row's section comes from `prRowPlacement` over the PR record's `checks` (`prEvidence` in `packages/board/src/server/fleet.ts`; the `ci-failing` stuck state at `packages/board/src/server/stuck.ts:303`), and that record came from an older read than the index. Fix direction named in the issue: a row reads the checks of the PR's current head, and a newer index answer for the PR replaces an older one.

**What already works**, so the plan does not re-build it: `/api/approve` writes `plan:approved` and the plan-link comment (`approve.ts:1177`); `/plot-deliver` and `/plot-release` write `plan:delivered` and `plan:released` (`deliver.ts:546`, `:969`); fleetd writes the slice progress line (`packages/fleet/src/shared/auto-progress.ts:39`).

**Required behaviour**, from the issue:

1. An issue that a plan on the default branch names shows in the *In progress* lane while the plan is started and not delivered, with no change to the local checkout.
2. Every issue of a released plan carries `plan:released`.
3. A review finding ticket closes, or says why it stays open, when the PR it reviews merges and its findings are settled.
4. The plan comment stays one comment with its ticket and progress lines, across writers and accounts.
5. A slice row shows the CI state of its PR's current head within one index refresh after a push.

## Design

### Approach

_To be filled in before approval. The issue names the gaps and the required behaviour; it does not prescribe a fix for each. Gap 1's fix direction already has an approved plan in flight (#2981) — this plan's first slice should confirm `referencedIssues` consumes that walk's resolved plan set rather than re-deriving a second source. Gaps 2-3 need a backfill/closure mechanism decision (one-off script vs. a reconcile-scan addition vs. a new lifecycle write) before slicing. Gap 4 tracks #2935 and #2924 rather than re-specifying them._

### Open Questions

- [ ] Gap 1: does `referencedIssues` read the plan walk's resolved set directly, or through a shared index the board already builds client-side (see `every-plan-reference-shows-its-issue`, #2993, for a related but distinct plan-index effort)?
- [ ] Gap 2: is the `plan:released` backfill a one-off migration over the 38 known issues, or a standing reconcile-scan section that catches future drift too?
- [ ] Gap 3: what counts as "settled" for a review finding — every finding in the ticket marked fixed by a person, or a re-review confirming none reproduce?
- [ ] Gap 5: which read is stale — the scan's carried PR listing, the board's cached `/api/fleet` rows, or both — and does the row take the newer of the index row and the scan's record by `updatedAt`, or always the index row for an open PR?
- [ ] Gap 4: does this plan carry #2935 and #2924 as its own slices, or only track them as external dependencies this plan's "done" waits on?

## Slices

### Implementation

- `feature/an-issue-shows-its-plan-s` — <!-- To be sliced during Design/Approval. Candidate slices: (1) referencedIssues reads the plan walk's set; (2) plan:released backfill; (3) review-finding ticket closure; (4) tracks #2935/#2924; (5) a slice row reads its PR's current-head checks. -->

## Notes

Created from tracker issue #2997 (https://github.com/plot-pm/plot/issues/2997). Gap 1 overlaps with the in-flight `the-plan-walk-moves-into-the` (#2981, approved) and is adjacent to `every-plan-reference-shows-its-issue` (#2993, approved) — the latter renders a plan's issue prefix on the board's own UI, this plan's gap 1 is about the tracker-facing lane classification, a different concern reading a related data source. Gaps 2-4 have no existing plan as of 2026-11-01.

This plan intentionally stops at Draft: it names the gaps and required behaviour from the issue without committing to a design or a slice breakdown. The Design section's Open Questions are what the next reader resolves before approving.

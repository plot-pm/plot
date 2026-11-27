# Testability juror

Position: amend

## Motivation facts

- True: `releaseApprovable` at `release-approvable.ts:65`, `mergeArm` at `slice-pr-next.ts:481`, `HoldReason` at `slice-pr-next.ts:162` (open set, `(string & {})` at :182).
- True: #3719 got 14 heads from 14:33:17 to 20:37:05 UTC on 2026-11-26 (GraphQL `HEAD_REF_FORCE_PUSHED_EVENT`); on `e150fd7c1` `validate` passed 20:30:57, `plot/review` pending 20:34:34, success 20:36:00; `a232b0959` arrived 20:34:34.
- True: `fleet-stopped.json` `at: 2026-11-26T22:31:26.076Z`; `plot/review` success on `8e1373e0f` at 22:31:49; #3719 merged 2026-11-27T07:52:00Z as `a55df0f41`.
- Incomplete: the last first-parent merge into main before the stop is `6c639d891` at 20:36:09 UTC (`git log origin/main --first-parent`). From 20:37 to 22:31 the fleet ran, main did not move, `validate` was green on `8e1373e0f` at 20:55:50, and no review started until 15 s after the stop. The stop did not end head motion; head motion had already ended. The plan does not explain the 96-minute gap between green CI and the review start, and that gap is a second cause the hold does not touch.
- Not addressed: the person approved 9 h 21 min after the review. A hold bounded at `Checks wait` (3600 s) would have expired about 8 h before that approval, and the next merge would have moved the head again. The plan must state that the hold helps only when a person approves within `Checks wait` of the review.

## Design against the measured problem

- The Approach says the hold starts at a trusted `success` review. On `e150fd7c1` the head moved in the same second the review started, so a success-start hold never begins on the measured run. The open question `[question-hold-before-review]` recommends `pending` or `success`, and the slice branch builds that (`origin/bug/a-waiting-release-holds-merges:packages/domain/src/rules/release-hold.ts`, `review !== 'pending' && review !== 'success'`). The Approved text and the code disagree; the plan text must state the built rule.
- Even `pending` needs `plotReviewSha === head`, so the window from green CI (20:30:57) to review start (20:34:34) is still open, and that is the window in which `a232b0959` was produced. A test that replays the 20:30–20:35 readings would show the hold does not fire; the plan must say whether green CI alone starts the hold.
- The rule re-derives "ready" from the index row. `releaseStage` (`release-prepare.ts`) already decides `ready` and reads more: the sprint scope (`waiting-scope`), a foreign head (`release-head-foreign`), and the required workflow's runs (`requiredChecks`), not the row's `ciChecks`. A release in `waiting-scope` or `release-head-foreign` cannot be approved (`releaseStageView` sets `approvable` only for `ready`), yet `releaseHold` holds main for it. That is a starved fleet for an hour per head with no approval possible. The hold must key off `releaseStage === 'ready'` (or call the same predicates), with a test per non-ready stage.
- New failure, throttling: Changesets keeps a release PR open whenever unreleased changesets exist. After each expiry the next merge makes a new head, which goes green and reviewed and holds for another `Checks wait`. With nobody approving (overnight), main takes about one merge per CI time plus 60 min instead of one per main CI cycle, indefinitely. The plan needs a cap across heads (per release PR, or per period) or an explicit statement that this cost is accepted, and a multi-pass test that measures it.
- Repair: the slice skips the hold where `repairAdmitted`. On a red main every other PR already holds `default-branch-red` first, so `release-waiting` is unreachable there. Good, but the tests named only "the named repair PR"; `repairMergeVerdict` also admits `revertPr` (`bug/revert-<n>`), which needs its own case.
- `[question-person-merge]` says the hold binds `plot-ask.mjs merge`, but neither slice changes `mergeAt`. Either a slice adds the hold to `mergeAt` with a test, or the text drops the claim.

## Rules and their tests

- `releaseHold` (domain rule, `rules/release-hold.ts`): the branch's 15 cases cover open/merged/closed, branch prefix, base, CI not counted, review absent/failed/unchecked/older head, lift for this and another head, expiry, re-hold refusal, new head after expiry, unparseable `since`. Missing: the boundary `now - since === boundMs - 1` holds and `=== boundMs` does not (the code uses `>=`; "ends past the bound" passes for any comparison if it uses a value far past), and a record whose `head` matches but `liftedBy` names a different head is not expressible because `liftedBy` carries no head; the record shape must make a lift name its head or the lift test can pass while the wrong head is lifted after a head change.
- Record advance: the decision "write `{head, since: now}` when the record names another head" sits in `releaseHoldReading` in `packages/fleet/src/shared/auto-merge.ts`, not in the domain. It is a decision about persisted state (like `advanceSettled`) and must be a domain rule with unit tests: no record, same head, new head, expired head, lifted head, write failure.
- `mergeArm` order: tests must pin that `default-branch-red`, `default-branch-stale`, `default-branch-unsettled` and `merge-in-flight` win over `release-waiting`, and `release-waiting` wins over `conflicting` and merger-app holds; that a PR into `sprint/x` is not held; that the release PR itself (`release.pr === row.number`) is not held; and that an absent `releaseHold` reading merges. A test that sets only `releaseHold: holds` on an otherwise green reading cannot tell an early return from a correct order.
- Selection of the release row: `releaseHoldReading` takes the first `changeset-release/` row when none targets the default branch, then `releaseHold` answers `base-not-default`. Needs a test with two release rows (one into `sprint/x`, one into main).
- Index read: the hold reads non-terminal `ciChecks` and `plotReview` from an OPEN row. A merged release whose row still reads OPEN holds until the bound. The CLAUDE.md paragraph the brief asks for must name this bound, as the review-arm paragraph does, and a test must show a stale OPEN row stops holding at `boundMs`.
- Board slice: the row text "holds merges since <since> · ends <since + Checks wait>" and the Status word must be domain properties with unit tests (Every rendered state is a domain property), plus one browser test that the badge shows it. The lift controller must refuse a head that the record does not name (no record, other head), with a test.
- Two writers: fleetd writes the record in slice 1, the lift controller writes `liftedBy` in slice 2. A read-fold-write by each races; fleetd's new-head write can drop a lift written between its read and write. Slice 2 needs one writer (fleetd applies a lift request file) or a fenced write, and a test that interleaves the two.

## Required changes

1. Rewrite the Approach's start condition to the built rule (green CI and a `pending` or `success` review on the head), or start at green CI alone, and state which with the 20:30:57/20:34:34 replay as its test.
2. Derive the hold from `releaseStage(...) === 'ready'` or its predicates, so `waiting-scope`, `release-head-foreign` and a red required workflow hold nothing; add one test per stage.
3. State the throttling cost across heads and either cap total hold time per release PR or record the cost as accepted; add a multi-pass test.
4. Correct the Motivation: no merge landed from 20:36 to 22:31 while the fleet ran, and the approval came 9 h after the review, which `Checks wait` does not cover.
5. Move the record-advance decision into a domain rule with unit tests.
6. Add tests: bound at `boundMs - 1` and `boundMs`; hold order in `mergeArm` against each default-branch hold and `conflicting`; `revertPr` admitted on red main; two release rows; stale OPEN row ends at the bound.
7. Before slice 2: give `liftedBy` the head it lifts, choose one writer for `release-hold.json` or fence the write, and make the lift refuse a head the record does not name.
8. Drop the `plot-ask.mjs merge` claim from `[question-person-merge]` or add `mergeAt` to a slice with a test.

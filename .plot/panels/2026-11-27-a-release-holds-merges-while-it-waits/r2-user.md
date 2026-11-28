# User juror, round 2: a-release-holds-merges-while-it-waits

Position: amend

Lens: the operator who releases. The amended plan keys the automatic hold on `releaseStage`, and in this estate a release that the operator can approve almost always reads `waiting-scope`. In that stage the amended hold holds nothing, so the measured night is not covered. #3754 already closes the review gap. What remains is the operator's own clock, and the person-started hold covers that.

## Rubric 1: round 1's "Changes for the author"

- Item 1, start at green CI and replay 20:30:57–20:34:34Z: partly applied. Plan:39 starts at green CI and slice 1 names the replay test (plan:59). With the readings of that day the stage is `waiting-scope`, and plan:38 says that stage holds nothing, so the named test contradicts the rule it tests.
- Item 2, readiness from `releaseStage` and the record rule in the domain: applied (plan:38, plan:41). This change causes the gap in rubric 2.
- Item 3, cap across heads, person hold, one writer: applied (plan:40, plan:42, plan:43).
- Item 4, name the direct pushes and the late review: applied (plan:24, plan:30, plan:46). Plan:30 still routes the late review to `a-stale-pending-review-is-asked-again`; #3754 fixed it on main, so the Motivation is out of date.
- Item 5, `plot-ask.mjs merge`: applied (plan:45, slice 2).
- Item 6: the hold in *Waiting on you* in slice 1 is applied (plan:47, plan:59). The zio passkey issue is filed (#3750). The passkey's `localhost` limit at the approve button is missing from the plan. A notice when a hold begins and ends is missing.

## Rubric 2: the measured case and `[question-stage-on-2026-11-26]`

- `releaseStage` returns `waiting-scope` before it reads checks or review: `release-prepare.ts:228-229` (`scope.read === 'none'`, or any scope slug not `delivered`).
- The scope holds plans that are not Delivered for days: `docs/sprints/2026-W47-plot-describes-itself.md` (Active, ends 2026-12-04) has `fleet-state-is-read-whole-and-from-one-home` unchecked, and this plan itself is Approved in sprint `fleet-runs-safely-alone`.
- fleetd's logs on this machine (`.plot/logs/fleetd.log*`): 20989 `release waiting-scope: hold`, 70 `release preparing`, 21 `release preparing: review`, 14 `release ready: notify`. `waiting-scope` is the normal stage, not an edge case.
- `releaseApprovable` (`release-approvable.ts:65`) does not read the stage. The approve button enabled on #3719 while the stage read `waiting-scope`, and the operator approved in that stage.
- Answer: on 2026-11-26 heads `e150fd7c1` and `8e1373e0f` read `waiting-scope`. The amended `releaseHold` holds nothing for either head. The plan's own recommendation (plan:52) then requires this second round before slice 2.
- The fix: decide the hold from the predicates `releaseApprovable` uses (open release PR into main, required workflow green on the head, review absent, pending or success on the head) and from the terminal stages only (`merged`, `publishing`, `released`, `failed`, `release-head-foreign` hold nothing). The scope must not lift the hold, because the scope does not stop the approval.
- #3754 changes the cost side. `releasePrepareNext` now starts a review in `waiting-scope` (`release-prepare.ts:317-326`). On `e150fd7c1` green CI to review success took 5 min (20:30:57 to 20:36:00). The window a merge must not hit is now minutes, not 1 h 36 min.

## Rubric 3: new failures

- The per-PR budget spends at the wrong time. #3719 got 14 heads from 14:33 to 20:37 UTC with nobody approving. With the hold keyed as in rubric 2, the budget of 3600 s can run out in the afternoon, and at 22:31 when the operator is present no automatic hold is left. The hold then costs fleet merges and gives the operator nothing. Only the person hold covers the moment of approval.
- Overnight: bounded. After `spentMs` reaches `boundMs` no automatic hold starts (plan:40); a person hold ends `boundMs` after the press (plan:43). The fleet is not starved overnight.
- Main repair: not blocked. The repair and revert PRs are exempt (plan:44); PR #3746 uses `repairAdmitted` (`slice-pr-next.ts` hunk at `mergeArm`).
- Second writer: resolved by two files with one writer each (plan:42).
- A person hold pressed on a board where the passkey cannot complete (zio's tailnet board, #3750) holds the fleet for `boundMs` for an approval that cannot happen. The plan does not say whether the hold routes accept a remote write, or what the button says there.

## Rubric 4: done-when and PR #3746

- Slice 1's tests are unit-checkable, except the replay test, which must pin the scope reading of that day (`waiting-scope`, one plan not Delivered). Slice 2's tests are checkable; the lost-lift test is trivially true with two files and can stay as a regression test.
- PR #3746 (draft, head `36d32b8bb`) differs from the amended plan: `releaseHold` takes one index row and requires the review `pending` or `success` on the head (`rules/release-hold.ts`, reason `review-not-on-head`), so it starts after green CI, not at it; the bound is per head (`expired` from `since`), with no `spentMs`; the record is `{ v, head, since, liftedBy? }`, not `{ pr, head, since, spentMs }`, and holds the lift that plan:42 moves to `release-hold-person.json`; the write decision sits in `releaseHoldReading` in `auto-merge.ts`, not in a domain `advanceReleaseHold`; the diff touches no board file, so the *Waiting on you* row, the release row text and the Status word are missing.

## Rubric 5: readiness

- Slice 1 must not proceed on the amended text: built to plan:38 it holds nothing in the measured case. Slice 2 (person hold) covers the case where the operator is present, and it does not depend on the stage question.

## Required changes

1. Replace "Readiness comes from `releaseStage`" (plan:38): the hold reads the approvability predicates and holds nothing only in `merged`, `publishing`, `released`, `failed` and `release-head-foreign`; `waiting-scope` holds like `preparing`. Add a test for a hold in `waiting-scope`.
2. Close `[question-stage-on-2026-11-26]` with the answer above and the log counts, and pin the replay test's scope reading to `waiting-scope`.
3. Update plan:30: #3754 fixed the review that did not start; remove the route to `a-stale-pending-review-is-asked-again`.
4. Bound the automatic hold per head to the window from green CI to the review result on that head (about 5 min on 2026-11-26), in addition to the per-PR `spentMs` cap, so that afternoon heads do not spend the budget the evening needs. Or state why one `Checks wait` per PR is worth spending while nobody approves.
5. Put the person hold first, or ship it in slice 1: it is the part that covers the operator's 22:31 approval.
6. Name the passkey's `localhost` limit in the release row and as the disabled reason of "Approve release" and "Hold merges" on a board that cannot approve (#3750), with a domain property and a test.
7. Send a notice when a hold begins and ends, or state that *Waiting on you* is the only signal. Note that `releasePrepareNext` notifies only in `ready` (`release-prepare.ts:341-346`), so in `waiting-scope` the operator gets no ready notice today.
8. Rework PR #3746 to the amended plan: start at green CI, per-PR `spentMs`, the `{ pr, head, since, spentMs }` record without `liftedBy`, `advanceReleaseHold` in the domain with the six cases, and the three board texts.

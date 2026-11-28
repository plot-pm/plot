# Testability juror, round 2

Position: amend

## 1. Round 1's changes for the author

- Item 1 (start at green CI, replay test): applied in the Approach ("The hold starts at green CI") and in slice 1's tests ("a replay of 2026-11-26 20:30:57–20:34:34 UTC ... holds #3738"). The replay cannot pass as written, see finding 2.
- Item 2 (readiness from `releaseStage`, record rule in the domain): applied as text. `advanceReleaseHold` is named as a domain rule with five cases. The `releaseStage` half is applied, and it is the wrong source, see finding 2.
- Item 3 (cap across heads, person hold, one writer): applied. `spentMs` per release PR, a person hold of `boundMs` from the press, and two files with one writer each (`release-hold.json` by fleetd, `release-hold-person.json` by the controllers).
- Item 4 (name the direct pushes and the review that did not start): applied. Motivation counts 5 merge heads and 9 push heads, names the 96-minute review gap and routes it to `a-stale-pending-review-is-asked-again`. #3754 now fixes that gap for `waiting-scope`; the plan does not yet say so.
- Item 5 (`plot-ask.mjs merge`): applied. Slice 2 adds `mergeAt`'s `release-waiting` refusal with a test for main and for `sprint/x`.
- Item 6 (hold in *Waiting on you* in slice 1, passkey limit, issue): applied. Slice 1 carries the three texts; the passkey limit is issue #3750. The plan does not say the approve button names the `localhost` limit; that is now #3750's scope.

## 2. The measured case and `[question-stage-on-2026-11-26]`

- Answer: no, a hold that reads readiness from `releaseStage` holds nothing on 2026-11-26. `releaseStage` (`packages/domain/src/rules/release-prepare.ts:228-229`) returns `waiting-scope` while any scope plan is not Delivered, BEFORE it reads the PR, the required workflow or the review (`:230-235`). #3754's plan states the sprint `plot-describes-itself` held five undelivered Musts that evening. So on `e150fd7c1` at 20:30:57 and on `8e1373e0f` from 20:55:50 the stage was `waiting-scope`, and the plan's rule "every other stage (`waiting-scope`, ...) holds nothing" lets #3738 merge at 20:33:37. The plan's own replay test fails against its own Approach.
- `releaseStage` is the wrong readiness because the approval does not read it. `releaseApprovable` (`release-approvable.ts:65-76`) reads only open, head, `ciChecks` counted on `checksSha === headSha`, the trusted review on the head and the passkey; no caller gates the button on `releaseStageView(...).approvable` (only `tuple-row.ts:805` uses the label). 2.37.0 was approved in `waiting-scope` at 07:52 on 2026-11-27 (`a55df0f41`).
- The readiness the hold must read is "a person could approve this head once its review passes": the PR is open into the default branch, the head is not `release-head-foreign` or unread (`releaseHeadHold`, `release-prepare.ts:243-251`), the required workflow is green on the head (`requiredChecks`, `:186-195`), and the trusted review on the head is absent, `pending` or `success`, in `preparing`, `waiting-scope` (read scope) or `ready`. This is the same predicate set as #3754's shared review checks (`releaseReviewStep`, `:268-289`) plus `success`. It belongs in `release-prepare.ts` as one exported rule beside `releaseStage`, so the review start and the hold cannot drift.
- Wiring gap: the plan says `releaseHold` reads "the release readings that fleetd's release tick already passes to `releaseStage`". The release tick runs in `registryd-main.ts:4066` and reads `ports.runs` and `ports.headChanges`; the merge arm runs in `auto-merge.ts` over index rows. The plan does not say how the merge pass gets the release tick's readings in the same pass, or which of the two runs first. Without that, the merge tick either re-asks the host (a new spend) or reads the previous pass's readings (one pass stale). Name the source and add a test that the merge arm sees the hold on the pass where the release tick first reads green.

## 3. New failures

- Stranded main: none found. On a red main every PR already holds `default-branch-red` first (`slice-pr-next.ts:513`), and the repair or revert PR the record admits skips `release-waiting` (#3746 adds `!repairAdmitted` before the hold).
- Overnight starvation: bounded by `spentMs` per release PR. But the plan does not define what time is summed. If `spentMs` is wall time from `since`, a fleet stopped mid-hold (as on 22:31:26) spends the budget while nothing runs, and a fleet restarted after a gap with an old `since` can spend the whole budget in one pass. Define `spentMs` as the sum of held intervals between consecutive passes, each capped at the pass interval, and test a gap.
- Budget burned with no reviewer: green CI starts the hold even where `reviewStartAllowed` refuses (`startBudget` spent) or `Auto-review` is off. The hold then holds main for `boundMs` with no review able to reach `success`. The readiness rule must hold nothing where the review is absent and no review can start, or the plan must state the cost is accepted.
- Second writer: resolved by the two files. One race remains: a lift "ends the automatic hold for that head", but fleetd reads the person file and writes `release-hold.json` in the same pass; the test must show a lift written between fleetd's read and write still ends the hold on the next pass (slice 2 names this test).

## 4. Done-when tests and PR #3746

- Replay 20:30:57–20:34:34 in `waiting-scope`: the test must build its readings with a read scope whose plans are not all Delivered. A replay with an all-Delivered scope passes while the rule is wrong for the measured day. Assert #3738 holds as `release-waiting` at 20:33:37 and the head's `since` is 20:30:57.
- Cap across heads: three heads of one PR, 25 min each, `boundMs` 3600 s; assert the third head holds until `spentMs` reaches 3600 s and not one pass later, and that a new PR number starts at 0. A test with one head long past the bound passes for any summation.
- Person hold: hold at T, new head at T+10 min, assert held at T+boundMs−1 and not at T+boundMs; assert a person hold holds after `spentMs` is spent.
- Lift: a lift naming head A ends the hold for A and both holds; after a new head B the automatic hold for B starts again; a lift naming B while the record names A refuses.
- Bound: `since + boundMs − 1` holds, `since + boundMs` does not (#3746's "ends past the bound" uses a value far past and cannot tell `>` from `>=`).
- Repair admission: on red main, the repair PR (`bug/main-repair-<12 hex>`) and the revert PR (`bug/revert-<n>`) merge while the hold holds; on green main a PR on the closed record's repair branch is held.
- What #3746 must change: (a) replace the index-row readiness in `rules/release-hold.ts` (`ciChecks`, review `pending` or `success`) with the predicate in section 2, starting at green CI with the review absent; (b) move the `{head, since}` advance out of `releaseHoldReading` in `auto-merge.ts` into `advanceReleaseHold`; (c) add `pr` and `spentMs` to `ReleaseHoldRecordSchema` and drop `liftedBy` (the lift moves to the person file); (d) add the board texts as domain properties with one browser test; (e) add the boundary, cap, `waiting-scope` replay, two-release-rows and revert tests.

## 5. Readiness

Slice 1 must not proceed on the current text: its readiness source makes its own replay test fail. Slice 2 waits on slice 1 and is otherwise checkable.

## Required changes

1. Replace "Readiness comes from `releaseStage`" with an exported rule in `release-prepare.ts` that holds in `waiting-scope` (read scope), `preparing` and `ready` where the head is clean, the required workflow is green and the trusted review on the head is absent, `pending` or `success`; close `[question-stage-on-2026-11-26]` with the answer `waiting-scope`, citing `release-prepare.ts:228-229`.
2. State in the Motivation that #3754 now starts the review in `waiting-scope`, so the 96-minute gap is fixed there.
3. Name how the merge pass reads the release readings (shared pass, order, or index fields) and test the first green pass.
4. Define `spentMs` as held time between passes, capped per pass, and test a fleet stop during a hold.
5. Hold nothing where the review is absent and cannot start (spent start budget, `Auto-review: false`), or state that cost.
6. Build the replay with an undelivered scope plan, and add the boundary, cap, person-hold, lift, repair and revert cases listed in section 4.
7. Rework PR #3746 per section 4 (a)-(e) before it leaves draft.

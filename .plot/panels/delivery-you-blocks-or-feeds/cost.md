# Juror: cost

Position: amend

## 1. False or unverified claims

- The PR rule's first condition needs a reading the board does not take. `PrReading` holds only `ci` and `review` (`packages/domain/src/rules/delivery-placement.ts:37-40`). `rules/human-comment-open.ts` is consumed only by `workflows/merge.ts` and `fleet/src/shared/auto-merge.ts`; no board file names it (grep over `packages/board/src`: 0 hits). The design's Non-goal forbids new host reads (spec:221). The plan does not name this cost or say where the conversation reading comes from.
- "when the repository does not declare `Auto-review: true`" widens today's rule silently. Today it needs `ci === 'passed'` and review `pending|none` (`delivery-placement.ts:216`). Read literally, a PR with red CI or a running build moves to Blocks delivery when Auto-review is off. The spec repeats the same wording (spec:187), so the plan inherits it; nobody has tested it against the current rule.
- "the HIGH finding has spent the `Correction budget`" is narrower than today's `fleet-stuck` case, which also fires on a failed CI with the budget spent, and on `gateUnpassable` (`delivery-placement.ts:212-214`). The plan does not say whether those cases stay or go.
- "Unblock holds loose branches and closed PRs ... each with Release and Delete" is mostly shipped already. The `loose` reason, `ReleaseClaimButton` (`AgentList.tsx:1170`), `LooseDeleteButton.tsx` and `loose-ends-show-under-unblock.browser.test.ts:23` ("shows the reason and the release and delete buttons") all exist. The new part is the closed PR, and `delivery-readings.ts:128` drops closed PRs before placement. That is a reading change, and the plan names it as placement only.
- "You ignores the Mine filter's three modes" is a behaviour change. Today `mineAllows(input.mine, item.ownership)` gates every You row (`delivery-placement.ts:337`). The plan states it as a design fact and assigns it to no slice.
- "Rebuild the board artifact with each slice" (plan:23) conflicts with `scripts/check-no-bundle-diff.sh`. Plan 1's panel already flagged the same sentence (`delivery-tab-header-and-my-sprint.md:44`).

## 2. Slices and Changelog

- Both slices name something that ships. The Changelog matches them, except where the bullets above make it inexact: "loose branches ... with Release and Delete" describes existing behaviour as new.
- The slice split does not follow the domain seam. `feature/delivery-you-plan-rows` holds the Unblock rows with Release and Delete, but `feature/delivery-you-groups` decides what Unblock holds. Both edit `delivery-placement.ts`, `delivery-row-form.ts:386-387` (group-keyed actions) and `AgentList.tsx` (1632 lines). Both wait only on `feature/delivery-section-header`, so the fleet starts them in parallel against the same files.

## 3. Most serious gap

The tickets go missing. Slice 1 takes tickets out of You's rows (`delivery-placement.ts:202` today places a reader's ticket in Input to the fleet). The Tickets section is plan 6 (`delivery-machine-tickets-footer.md:43`), and no `waits:` orders the two plans. Between the merges, a reader's unplanned tickets show on no row of the tab, which breaks the design goal "Every work item ... still shows once" (spec:214). The Open Question asks only where the count links. The bigger cost is that the rows have no home, and the plan does not say so.

## 4. Changes

1. Add `<!-- waits: feature/delivery-tickets-section -->` to the ticket part of slice 1, or keep ticket rows in You until plan 6 merges. Either answer closes the Open Question.
2. Name the source of the "unanswered comment from a person" reading. Either cite an existing read the board can fold in, or drop that condition to a later slice and record it as a gap, as the spec does for tokens (spec:184).
3. Write the PR rule as the delta from `delivery-placement.ts:210-217`: keep `ci === 'passed'` on the Auto-review arm, and say what happens to `gateUnpassable` and a failed CI with the budget spent.
4. Move all placement changes (groups, PR rule, closed PR reading, the Mine bypass) into slice 1. Make slice 2 wait on slice 1, and limit it to rendering: plan row, chips, columns. That removes the parallel conflict on `delivery-placement.ts`.
5. Declare the ordering with siblings that edit the same rule: plan 1's to-do markers and scope slice (`delivery-tab-header-and-my-sprint.md:10,39,43`) and plan 3's `workGroup`/Queued changes (`delivery-work-items-show-gates.md:13,41`). Today five siblings wait only on the section header and land on `AgentList.tsx` at the same time.
6. Count the test fan-out: `delivery-placement.test.ts` names the old group ids 18 times. Six board tests import the rule, including `ticket-input-to-the-fleet.browser.test.ts`, which this plan breaks by design.
7. Replace "Rebuild the board artifact with each slice" with "rebuild locally to test; commit no bundle".

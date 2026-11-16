# Deliverable lens verdict

Position: amend

Read: the subject plan in full; the design spec's Release Delivery section (lines 72-86) and Calls Made After Review (181-188); plan 1 (`delivery-tab-header-and-my-sprint.md`) slice list and open questions; plan 3's slice marker; `packages/board/src/app/lib/agent-rows/delivery-view.ts`, `packages/domain/src/rules/known-pr.ts`, `auto-dispatch.ts`, `auto-deliver.ts` by grep. Not run: no tests, no board. Not read in full: plans 3, 5 (fleet), 6, `a-deferred-slice-keeps-its-branch`, `red-hold-reads-the-pr-base`, the 2026-11-08 spec, the story.

## Findings

1. (blocks) `feature/delivery-release-person-cards` (plan lines 72-74) waits only on `feature/delivery-section-header`. The cards need the sprint Owner (the release's people are the owners of the sprints that name the release; spec line 181). That field is built by plan 1's `feature/sprint-owner-field` (delivery-tab-header-and-my-sprint.md:91), which no marker here names. Line 34 says only the sprint-scope slice uses the Owner field. The slice cannot be built or tested on a sprint with Owner until that slice lands.

2. (blocks) Settled Questions (line 55) says the sprint-scope slice waits on `delivery-section-header` and `delivery-my-sprint-scope`. The marker at line 78 lists only `delivery-my-sprint-scope`. The slice also edits the section that `feature/delivery-release-plan-rows` creates (grouping plans by sprint, the title), so it needs a wait on that slice. The pulse would otherwise start it in parallel with a slice whose output it changes.

3. (misleads) The "Owner" column of the plan row (Changelog line 17, Design line 38) has no data source. A plan file has no owner field (the Status block lines 7-13 has none), and plan 1 adds Owner to sprints only. No slice or "Left to the Builder" item says whether Owner is the sprint's owner, the plan's author, or the slice agents. The plan-rows slice cannot decide that unaided.

4. (misleads) Needed data is missing from every slice. (a) Per-slice `mergedAt`: the "merged 2 days ago" text needs it per slice. `mergedAt` exists on the host PR type (`known-pr.ts:38`, `:197`), but no slice carries it to the board payload per slice. The Open Question about the no-`mergedAt` case sits on top of that gap. (b) "Blocked" means the slice sits under You › Blocks delivery (line 38). That group is built by plan 4 (`delivery-you-blocks-or-feeds`). (c) "Links to its row in Work items or You" needs the row anchors that plans 3 and 4 create. None of these three waits is declared in any marker. Without them the strip cannot show the five states, and the Done When on in-flight links (line 50) cannot be asserted.

5. (misleads) `feature/delivery-release-plan-rows` is too large for one agent and one PR. It holds the header counts, the strip with five states, the collapsed row, the Done / In flight / To do grouping, the Work items / You links and the waits-for text. The person-cards slice also holds a second feature, "one block per target release" (restructuring the whole section). The split should have the strip and its domain facts first, then the opened list, and the per-release blocks as their own slice, so each PR is reviewable.

6. (misleads) Changelog and Done When against slices. The four Changelog bullets map to slices: bullet 1 and 2 to plan-rows, bullet 3 to person-cards, bullet 4 to sprint-scope. But slices build things no bullet states: the header counts (line 37) and the per-release blocks (line 42) appear in no bullet. Done When has four items and none for person cards, header counts or per-release blocks. Those three have no assertable "done" that a test could check. Done When 1 (40 slices, 8 rows) and 2 (strip sums to slice count) are testable and covered by the plan-rows slice.

## Approval

As written the plan cannot be built in a safe order. Fixes needed: add `feature/sprint-owner-field` to the person-cards waits; add the plan-rows wait (and section-header) to the sprint-scope slice, or fix the Settled Questions line; name the Owner column's source; name the slice that carries per-slice `mergedAt` and the waits on plans 3 and 4 for links and the Blocked state; split the plan-rows slice and the per-release blocks; add a Changelog bullet and a Done When for person cards, header counts and per-release blocks.

# Deliverable juror, round 2: delivery-you-blocks-or-feeds

Position: amend

The round-1 amendments hold on their own terms: slice 2 now waits on slice 1, the phase strip has its own slice, Mine has a slice and a Done When line, and the closed-PR Delete is limited to unnamed branches. The findings below are new.

## 1. Claims the source does not support

- **"You places an item only when its `ownership === 'mine'`" (plan:63) empties Unblock of loose branches.** A branch with no PR and no plan is `OwnedRow { kind: 'other' }`, which "carries no owner" (`packages/domain/src/rules/ownership.ts:70-78`), so its ownership is always `unknown`. Under the new rule every loose branch leaves You and falls to `workGroup`, stage `queued` (`delivery-readings.ts:183-184`), so it shows under Work items › Queued. The design says the opposite: "A closed PR or branch no plan names moves to You › Unblock, not Queued" (spec:116). Changelog line 5 ("as a loose branch already has") and the Unblock row of the table then describe rows that no longer appear. The same holds for `merge-conflict` "that no agent owns" and `agent-died` on a plan that names no assignee. Done When line 78 ("same rows in every Mine mode") passes with these rows gone.
- **Release on a closed-PR row is a button that refuses.** The release mechanics refuse when "origin/$br carries $remote_work commit(s) that change files" (`skills/plot/scripts/plot-dispatch.sh:1799`). A branch that carried a PR has such commits. The domain half refuses only open or merged PRs (`packages/fleet/src/shared/release-claim-reader.ts:25-30`), but the shell half still runs. The comment at `AgentList.tsx:1166` already says release refuses a branch with a PR. Done When line 79 ("both calling their controllers") is satisfied by a button whose every click refuses.
- **"`delivery-readings.ts:128` drops a closed PR before placement" (plan:64).** Lines 127-128 define `hasOpenPr`, which only keeps a closed PR out of `stage: 'pr'`. What keeps a closed PR from `loose` is `looseOf` returning `undefined` when no fixer record was read (`delivery-readings.ts:155-157`). The plan points the builder at the wrong line.
- **"A slice-count chip from `planSliceCount`" (plan:68).** `planSliceCount` is a field of `SliceSchema` in the pulse (`packages/board/src/contract/schema.ts:2310`). A Draft plan with no rows enters placement from `DraftPlanSchema` (`schema.ts:4316-4334`; `delivery-readings.ts:272-283`), which has no slice count. Done When line 80 ("a draft plan with five slices shows '5 slices'") names exactly that case. "Adds an open-question count to the plan payload" (Board impact) does not say which payload: the draft card or the slice.

## 2. Done When lines against slices

| Done When | Slice |
|---|---|
| 74 no reason repeats down Status | split: slice 1 drops `REASON_WORDS`, slice 2 builds the Status column; neither names the line |
| 75-78 groups, markers, PR arms, Mine | slice 1 |
| 79 closed PR with Release and Delete | split: slice 1 places it, slice 2 adds the buttons |
| 80-81 plan row, columns | slice 2 |
| 82 header counts and phase strip | split: slice 1 (counts) and slice 3 (strip) in one line |
| 83 no ticket row under You | plan 6's `feature/delivery-tickets-section` (`delivery-machine-tickets-footer.md:58` holds the same line); no slice here builds it |

Between slices 1 and 2, closed-PR rows sit under Unblock with no action while slice 1's group-keyed tables already write "Release · Delete" in the `loose` Do cell (plan:62).

## 3. Changelog against slices

The changelog has no line for slice 2's column change (Kind · Item · Status · Do · Age, no BY column, plan:67), the most visible change a reader sees. Every other changelog line maps to a slice.

## 4. What a builder must guess

- Which ownership values You admits for items that carry no owner (loose branch, conflict no agent owns, dead agent).
- Where a draft plan's slice count comes from.
- Whether Release on a closed-PR row must succeed, or may refuse with its reason shown.
- Plan 1's `feature/delivery-slice-states` classifies a slice "blocked" when it sits under You › Blocks delivery (`delivery-tab-header-and-my-sprint.md:45`). With a reader-relative You, a release's progress bar shows different counts to different readers. No plan says whether that is meant.

## 5. Most serious gap

The `ownership === 'mine'` rule removes every loose branch from the Unblock group the plan builds, and moves those branches to Queued, which the design forbids. Not fatal: name the predicate (for example `ownership !== 'theirs'`, or no ownership test for `loose`, `merge-conflict` and `agent-died`), add a Done When line that a loose branch with `unknown` ownership shows under Unblock in every Mine mode, and either prove Release succeeds on a closed-PR fixture or take Release off those rows with a question to Jan Wloka.

# Cost lens verdict: delivery-release-progress-per-plan

Position: amend

What I read: the subject plan, `packages/board/src/app/lib/agent-rows/delivery-view.ts` (lines 24, 180-200), a grep for `mergedAt` across `packages/board/src` and `packages/domain/src`, the header of `scripts/check-no-bundle-diff.sh` (lines 1-40), and the Board impact lines of the sibling plans. I ran no tests and did not open the design specs or the story.

## Findings

1. misleads: the plan's line 22 says to rebuild the board artifact (`pnpm build:board`) with each slice. `scripts/check-no-bundle-diff.sh:1-20` refuses any generated bundle in a PR diff, and `main` builds its own bundles. Three slices following the line literally would commit bundles and fail CI. Siblings already hold the correction: `delivery-tab-header-and-my-sprint.md:76` and `delivery-fleet-rows-per-agent.md:105` both say the rebuild is a local test only. This plan carries the same defect uncorrected, so it is not honest about the cost. Fix: reword to "run `pnpm build:board` locally to test; do not commit generated paths."

2. misleads: the plan does not say where "merged 2 days ago" and the PR link come from. In the board the `mergedAt` hits are in `server/deliver.ts`, `server/board.ts` and `release-chain-walk.ts`, and the only domain use is `known-pr.ts:38,197`. `delivery-view.ts` has no per-slice merge date. I did not trace whether the payload already carries a merged date per slice. The plan asserts a Done list with PR and date but names no source. CLAUDE.md "A Decision Reads The Index" allows a display read only from the PR index (MERGED rows are terminal and safe). The plan must state that the date and PR number come from the index or the existing payload, and that the slices add zero host calls. As written, a builder could add a per-slice `pr-view`, which is 40 calls per scan at 8 plans x 5 slices. Fix: add a Design bullet naming the source and forbidding new host reads.

3. misleads: the Open Question (line 59), which date a Done slice shows where the host reports no `mergedAt`, is the same cost question. The answer depends on finding 2 and should be settled before approval. A slice completed by a named commit has no PR row in the index, so the likely answer is to show no date. Say so.

4. cosmetic: the payload size for about 40 slices x 8 plans is not discussed. Each Done row adds a title, PR number and date. That is a few KB, which is small beside the existing `deliveredRows`, but the plan makes no claim. Cheap to state "derived from the existing rows, no new payload field", if true.

5. misleads: the merge-conflict blast radius and ordering are only partly stated. All three slices edit the Release delivery section of `delivery-view.ts` and `AgentList.tsx`. Plan rows and person cards both wait only on `feature/delivery-section-header`, so they are parallel with no ordering between them. They edit the same section and the same domain module, so one will rebase over the other. The sprint-scope slice waits on a different plan 1 slice. The plan says nothing about this overlap. Because bundles are not committed (finding 1), the conflict is source-only and manageable. Suggest ordering person-cards after plan-rows, or naming the shared file.

6. cosmetic: the "Done When" tests are unit tests in the domain, so CI cost is low. Nothing in the plan raises the rate-limit or scan cost beyond finding 2.

## Could not check

Whether the delivered payload rows already carry PR number and merge date. I did not trace `deliveredRows` through to the server payload. I did not open the design spec or the sibling plans beyond the grepped lines.

## Approvable as written

No. The plan is sound in shape and cheap if the date and PR link come from existing data. It needs three edits: the bundle instruction (finding 1), a stated data source with no new host calls (findings 2 and 3), and the slice ordering note (finding 5).

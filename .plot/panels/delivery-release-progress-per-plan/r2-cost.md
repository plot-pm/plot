# Cost lens, round 2: delivery-release-progress-per-plan

Position: amend

## What I read

The subject plan, the round-1 cost verdict, `delivery-tab-header-and-my-sprint.md` (lines 45, 74, 92, 95, 109-137), `delivery-work-items-show-gates.md` (lines 45, 67, 82, 104), the design spec (lines 81-84, 181, 186), `agent-rows/delivery-view.ts` (186-192, 423-439), `AgentList.tsx` (1219, 1378-1400), `agent-rows/collapse.ts:20`, `row-identity.ts:77`, `entities/pr-index.ts` (33-34, 81), `ports/refs.ts:138-146`, `rules/deliverable.ts` (grep). I ran nothing and did not open the story.

## Round-1 cost items: resolved correctly

- Bundle instruction: the Board impact line (line 26) now says build locally and commit no bundle, which matches `scripts/check-no-bundle-diff.sh`. Resolved.
- Person cards waiting on plan rows: line 116 carries it. Resolved.
- Payload: line 62 now claims "a few kilobytes". Unmeasured, but proportionate (about 40 rows, three small fields). Accepted.

## Claims checked

1. `deliveredBlocks`/`releaseLines` at `delivery-view.ts:186-192, 423-439`: true (`releaseLines` at 188-192, `deliveredBlocks` built at 436-439).
2. `AgentList.tsx:1378-1400`: true, the `release-delivery` section render. `:1219` is a `dispatch=` prop in a wave-group row: true.
3. `collapse.ts:20` `COLLAPSED_BY_DEFAULT = ['release-delivery', 'free']`: true.
4. `row-identity.ts:77` `isUnbegun`: true.
5. PR index MERGED rows carry `mergedAt` (`entities/pr-index.ts:81`, `z.string().optional()`) and a head branch (`:34`), so a slice-to-PR join without a host call is possible. True.
6. `sliceProgress` in `rules/deliverable.ts`: referenced at 145-164. True.
7. Plan 1's `feature/delivery-slice-states` waits on `feature/delivery-you-groups` only (`delivery-tab-header-and-my-sprint.md:121`): matches the plan's line 38 chain.

## Findings

1. Misleads, cost of correctness: the Done When line "the slice strip's five states add up to the plan's slice count" depends on plan 1's classification, which plan 1 itself lists as an unresolved question: the five states do not cover plan 3's Queued group (`delivery-tab-header-and-my-sprint.md:92`, unchecked). This plan states the sum as a unit-test assertion while the owner of the classification has not settled whether it holds. A builder of `feature/delivery-release-plan-rows` cannot write that test until plan 1 answers. The plan should name this as a wait on plan 1's open item, or say what the strip shows for a Queued slice.

2. Misleads, data source is half stated: line 56 says the PR number and `mergedAt` come from the PR index. The index row is `mergedAt` optional (`pr-index.ts:81`) and holds only rows the store retains. The plan says nothing about a slice whose MERGED row is missing, aged out, or not yet read (`complete: false` stores, a missing or wrong-version store, which CLAUDE.md "A Decision Reads The Index" says all mean "ask the host"). The plan also says it adds no host call, so the only legal answer is a Done line with no date. Nothing says that, and the Done When line "A Done line shows its PR and its merge date" cannot hold for those slices. State the fallback (no date, never a host read) so a builder does not add a per-slice `pr-view`.

3. Cost not named: the named-commit date "from local git". `ports/refs.ts:138-146` has `BranchDate` (a branch tip date), not a per-commit date. A per-commit committer date needs a new Refs operation and a git call per named commit per scan. The layering rule allows it only inside an adapter, and CLAUDE.md measured the spawn ratchet at 19 of 28 sites. The plan says "Neither adds a host call", which is true of a host and silent on a process spawn. State the Refs operation, that it batches or caches, and that it runs once per plan with named commits, not per row render.

4. Blast radius: `feature/delivery-release-person-cards` and `feature/delivery-sprint-delivery-scope` both wait on plan-rows and on nothing from each other, and both edit the Release delivery section module and `AgentList.tsx`. They can run in parallel and rebase over one another. Bundles are not committed, so the conflict is source only, but the plan states the plan-rows/person-cards ordering as the round-1 fix and does not extend it. Order the scope slice after the person cards, or name the shared file.

5. Attention, lower: plan-rows is one slice that replaces `deliveredBlocks` and `releaseLines`, drops the collapse default, adds header counts, per-release blocks, the strip, the opened list, the payload fields, removes rows from Work items and moves Start. That is the largest slice of the three, and a reviewer reads all of it in one PR. Round 1 chose to keep it whole. I do not re-raise the split; I note that the reviewer cost is stated nowhere and finding 4 of plan 3's waits mean it starts late.

6. Cosmetic: "about 40 slices across 8 plans" is the 2026-11-16 measurement and the payload claim reads off it; fine.

## Contradictions

- None that stops a slice. Finding 1 is a plan that misleads about a test it can write.
- The Settled Questions line "Every slice waits on plan 1's `feature/delivery-section-header`, directly or through another slice": plan-rows waits on `delivery-slice-states` and `delivery-work-items-gates`, both of which wait on `delivery-section-header` (plan 1 line 121 via you-groups, plan 3 line 82). True through the chain.

## Left out

Which scan the new payload fields ride on, and whether the not-started removal from Work items changes the Work items count shown in plan 3's group headers (plan 3 says it only states the exclusion, line 67). A builder of the removal hits a count that no plan assigns.

## Not checked

Whether the payload already carries a per-slice PR number. I did not trace `deliveredRows` to the server payload, and I did not run `pnpm build:board` or any test.

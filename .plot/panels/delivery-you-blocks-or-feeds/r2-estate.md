# Estate juror, round 2: delivery-you-blocks-or-feeds

Position: amend

Lens: what the plan says it builds, measured against what already exists. The round-1 amendments named the mechanisms the estate juror listed. Four of the new citations point at the wrong mechanism, and one amendment (taken from the round-1 estate verdict itself) breaks Unblock.

## 1. Claims the source does not support

- **"You places an item only when its `ownership === 'mine'`"** (Approach, *You ignores Mine*; Open Points [x] row 6). A loose branch with no PR and no plan reads `ownedFromRow` → `{ kind: 'other' }` (`packages/board/src/app/lib/agent-rows/mine-filter.ts:141-146`), and `ownership` answers `'unknown'` for it (`packages/domain/src/rules/ownership.ts:287-288`). So no loose branch ever reaches You. It falls through to `workGroup` and lands in Queued, which `delivery-work-items-show-gates.md:49` and spec:116 forbid. The same holds for every PR on Bitbucket: `prOwnership` answers `'unknown'` where `hostUser` is empty (`ownership.ts:103-106`), and `readerIsKnown` names "every Bitbucket repository" as that case (`ownership.ts:306-317`). Review, fleet-stuck and conflict rows then vanish from You on Bitbucket. Today, with Mine `off`, `mineAllows` passes all of these (`delivery-placement.ts:200-201`). The round-1 estate verdict recommended `ownership === 'mine'`, and that recommendation was wrong.
- **"Today `delivery-readings.ts:128` drops a closed PR before placement."** Line 128 is `hasOpenPr`, and it only decides `stage` (`delivery-readings.ts:164,176`). A closed PR stays an item of kind `pr`. What keeps it out of Unblock is a different chain. `withFixerInFlight` skips closed PRs (`packages/board/src/server/fleet.ts:6626`). `delivery-readings.ts` `looseOf` then returns `undefined` when `fixerInFlight` is absent (`:155-157`). The domain `looseOf` reads that as `not-loose` (`delivery-placement.ts:192`). Today a closed PR therefore sits in Work items › Queued, not nowhere. A builder who edits line 128 changes nothing. The plan must name the fixer-read gate on both sides and say what `fixing` means for a closed PR.
- **"from the story reading the Discovery tab already takes (`/api/stories`)"** (Approach, *Phase strip*). No `/api/stories` route exists: `packages/board/src/server/index.ts` routes `/api/story`, `/api/story-plan` and `/api/story-status`, and `StoriesResponseSchema` (`schema.ts:1097-1105`) is a comment with no caller. The Discovery tab reads `Board.storyLanes` (`schema.ts:1577`, `StoriesTab.tsx:160`), which `storyLanes` computes in `server/discovery-lanes.ts`, and the tickets-with-no-plan split comes from `ticketLanes` (`rules/ticket-lanes.ts:185`).
- **The phase strip hard-codes three names.** The design the plan cites says "The phases come from the `Workflow phases` config key" (`2026-11-08-delivery-tab-design.md:70`). `rules/workflow-phases.ts` (`phaseOfStory` at `:167`) and `declaredPhaseMap` already map stories and plans to phases. This repo declares `Development = plan:approved`, not "Handed to fleet". The plan does not say whether the strip reads the map or the fixed labels.
- **"No reason sentence repeats down the Status column"** (Done When 1). This holds today. The Status cell already shows `REASON_STATUS`'s short words ("draft", "loose", `delivery-row-form.ts:107-120`), rendered through `rowFormsOf` (`delivery-row-facts.ts:84`, `AgentList.tsx:32`). The sentence that repeats is the `itemTail` reason row, `reasonWords(item.placement.reason)` (`AgentList.tsx:1158-1163`, `REASON_WORDS` in `delivery-view.ts:44-56`). A builder can pass Done When 1 with no change and leave the measured repetition in place.
- Minor citation drift: `holdersOf` starts at `delivery-row-form.ts:378`, not 381. The draft exception is at `delivery-view.ts:246`, not 248.

## 2. What a slice needs that nothing provides

- **The slice-count source for a Draft plan with no rows.** `planSliceCount` lives on the pulse `Slice` (`schema.ts:2310`, `rules/pulse.ts:68`). A draft plan with no row becomes an item from `DraftPlan` (`delivery-readings.ts:272-283`), and `DraftPlanSchema` (`schema.ts:4315-4333`) has no slice count. `Card.sliceSummary.slices` (`schema.ts:281-290`, `board.ts:3093`) is the existing plan-level count, and the plan does not name it.
- **An ownership rule for loose items and fleet PRs** (see §1). No slice and no Done When line says whose a loose branch is.

## 3. What a builder would have to guess

- Whether "You always means the reader" means `=== 'mine'` (Unblock becomes empty) or `!== 'theirs'` (today's `mine` mode, applied in every mode).
- Whether the closed-PR change edits the server's fixer read, the domain `looseOf`, or both.
- Whether the strip reads `Workflow phases`, and whether its Discovery count reuses `storyLanes` and `ticketLanes` or recounts.
- Whether Done When 1 means the `itemTail` reason row goes away.

## 4. Most serious gap

The `ownership === 'mine'` rule takes every loose branch out of You on every host, and every PR out of You on Bitbucket. Unblock, the group this plan creates for loose ends, would hold nothing. A builder who writes the Done When test "You shows the same rows in every Mine mode" with a fixture reader whose ownership answers `mine` would pass it and ship the defect. The fix is an edit to the plan, not a new approach: state the admission rule per reason (for example `!== 'theirs'`, or "loose items are the reader's"), and add a Done When line for a loose branch with `unknown` ownership. Not fatal.

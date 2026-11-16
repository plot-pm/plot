# Estate juror, round 2: delivery-release-progress-per-plan

Position: amend

Read: the plan; the round-1 estate verdict; the sibling plans' Slices blocks and the sentences that name this plan (plans 1, 2, 3, 4, 6); the design's Release Delivery section; and in source `delivery-view.ts`, `AgentList.tsx`, `collapse.ts`, `row-identity.ts`, `fleet.ts` (`hasNoWork`), `schema.ts` (`unbegun`), `deliverable.ts`, `entities/pr-index.ts`. Ran only grep and sed. No tests, no inference about runtime.

## Claims checked and holding

- `delivery-view.ts:186-192` declares `releaseLines`, `delivered`, `deliveredBlocks`; `:423-439` builds them. Holds.
- `AgentList.tsx:1378-1400` renders the section (the `release-delivery` key, `releaseLines`, the `deliveredBlocks` grid). Holds.
- `collapse.ts:20`: `COLLAPSED_BY_DEFAULT = ['release-delivery', 'free']`. Holds. The plan's removal of the key is consistent with the design's "Groups and sections are always open" (design line 166).
- `row-identity.ts:77`: `isUnbegun`. Holds. Its meaning matches "no branch, no agent": `schema.ts` says "no commits, no claim, no PR", and `hasNoWork` (`fleet.ts:4055`) also covers `waiting`/`blocked` over `open`, so a slice waiting on an earlier slice is unbegun and lands under To do with a waits-for. Consistent with the table.
- `AgentList.tsx:1219`: `dispatch={start && !oneSlice ? dispatch : undefined}`. Holds. Note it sits on a wave-group card, not a per-slice line.
- Plan 3 (`delivery-work-items-show-gates.md:45,67,104`) and plan 1 (`delivery-tab-header-and-my-sprint.md:45`) both point at this plan for the not-started removal and for consuming the slice states. The ownership split is consistent across the three files.
- Plan 1 line 121 builds `feature/delivery-slice-states` with counts "per plan, per release and per sprint", so "plan 1's per-sprint slice-state counts" exists as a slice.

## Contradictions and gaps

1. (slice cannot be built as written, or builds against an absent field) `feature/delivery-release-plan-rows` builds the **Owner** column from "plan 1's sprint Owner field" (plan line 45), and the per-release blocks from the sprints' `Release:`. Its marker waits on `feature/delivery-slice-states` and `feature/delivery-work-items-gates` only. `feature/sprint-owner-field` (plan 1 line 113) has no waits, and neither wait chain reaches it: slice-states waits on you-groups (plan 2 line 104: section-header, tickets-section); work-items-gates waits on section-header and you-groups. The person-cards slice and the release-card both name `feature/sprint-owner-field`; plan-rows is the one slice that reads Owner and does not. Round 1 fixed this for person-cards and missed it for plan-rows. Add `feature/sprint-owner-field` to plan-rows, or drop the Owner column to a later slice.

2. (misleads) The Done line takes "its PR number and its `mergedAt` from the PR index" (plan line 56). `entities/pr-index.ts:81` declares `mergedAt: z.string().optional()`, "as the host spelled it", absent where the PR is not merged. `bitbucket-pr-row.ts:49` writes `''` for a non-merged row and `updated_on` for a merged one, so on Bitbucket the date is the last update, not a merge time. The plan gives a fallback only for the named-commit case. It does not say what a MERGED row with no `mergedAt` shows, nor that Bitbucket's value is `updated_on`. The "merged 2 days ago" wording would be wrong on that host. State the empty case and the Bitbucket caveat.

3. (misleads) "`sliceProgress`'s counts" (plan lines 44, 91). `sliceProgress` (`deliverable.ts:302`) returns the string `"<n> of <m> slices merged"`; the counts come from `slicesOf` (`deliverable.ts:175`), which is not exported. A builder cannot read counts from either export. Plan 1 owns the classification (its line 45) and must export or derive the counts; this plan should name that dependency rather than say it reads `sliceProgress`'s counts. Name differs, not a blocker for this plan if plan 1's slice exports it.

4. (misleads) Scope on Release delivery is applied twice. Plan 1's `feature/delivery-my-sprint-scope` (line 137) "applied to ... Release delivery", and it does not wait on plan-rows; this plan's `feature/delivery-sprint-delivery-scope` also applies scope to the same section after plan-rows. Between the two, plan-rows replaces the structure the first slice scoped. State which slice narrows Release delivery, and that plan-rows must keep whatever scope hook my-sprint-scope added to `deliveredBlocks` or the scope is lost on replacement. The rename to **Sprint delivery · <name>** is claimed by this plan but plan 1's slice says the toggle rename lands in my-sprint-scope.

5. (cosmetic) Start moves from a wave-group card (`AgentList.tsx:1219`, gated by `start && !oneSlice`) to a per-slice To do line. "Where the slice can start" is `isStartable` (`row-identity.ts:116`, `startability === 'start-work' && state === 'open'`), which reads a row; a To do slice with no Work items row after this plan's removal still needs a row-shaped input. The plan says Start eligibility is a domain property but does not say where the readiness input comes from once the row leaves Work items.

6. (cosmetic) Plan 3 line 44 lists `stage: 'queued'` under Queued; this plan removes unbegun rows from Work items. The two are consistent only because `isUnbegun` and "a branch or a claim" are disjoint; neither plan says so in one place.

## Not in the plan that a builder will hit

- `delivery-view.test.ts` and `delivery-readings.test.ts` (`packages/board/test/unit/`) both reference `deliveredBlocks` or `releaseLines`; the plan says the tests change but names neither file.
- `expandSection` (`AgentList.tsx:415`, per round 1; not re-read) opens the fold when a blocker mark points at a delivered slice. The plan replaces the fold with per-plan folds and says nothing about it.

## Ran vs inferred

Read and grepped: all citations above. Inferred: the `expandSection` behaviour (from round 1, not re-read), runtime effect of the Bitbucket `mergedAt`.

# Round 2, contradiction lens

Position: amend

## Read versus inferred

Read in full: the plan, plans 1, 3 and 2's slice lines, the design's Release Delivery, Collapsibles and The Plans sections, the round-1 contradiction verdict. Read in source: `agent-rows/delivery-view.ts:183-193,418-440`, `collapse.ts:20`, `row-identity.ts:70-117`, `AgentList.tsx:1215-1222,1376-1401`, `rules/deliverable.ts:140-158`. Did not run anything. Round-1 resolutions of waits, Owner, mapping table and the "in-flight only" guarantee hold against the siblings; I do not re-raise them.

## Claims checked

1. `deliveredBlocks`, `releaseLines` at `delivery-view.ts:186-192, 423-439`: holds (`:189`, `:192`, `:423`, `:436`).
2. `release-delivery` in `COLLAPSED_BY_DEFAULT` at `collapse.ts:20`: holds; and design line 166 ("Collapsibles exist in three places only... Groups and sections are always open") supports removing it.
3. `AgentList.tsx:1378-1400` Release delivery section: holds (`:1376-1401`).
4. `isUnbegun` at `row-identity.ts:77`: holds; it reads `row.group === 'not-started' && (row.unbegun ?? row.state === 'open')`.
5. Start (`dispatch`) at `AgentList.tsx:1219`: holds (`dispatch={start && !oneSlice ? dispatch : undefined}`).
6. `sliceProgress` excludes deferred-only slices: holds (`deliverable.ts:153-154`).
7. Plan 3 line 45 agrees that plan 5 owns the removal and Start; plan 1 line 45 agrees plan 1 owns the five states.

## Contradictions

A. Start eligibility (a slice cannot be built as written, as phrased). The plan moves Start "to the To do line of a slice whose earlier slices have landed" (line 57). `row-identity.ts:83-117` says the opposite rule: Start reads `startability === 'start-work'`, computed in `classify` from plan phase, branch state, slice verdict and brief state, and "slice ordering satisfied" alone was the earlier, wrong derivation. Also, `isUnbegun` removes the very rows that carry `startability`. A To do line has no AgentRow left to read it from. The plan does not say where the per-slice startability comes from once the row is gone, nor that "earlier slices landed" is only one of four inputs.

B. Column set (misleads). Plan 3 line 40 says "Release delivery rows keep `ROW_COLUMNS` unchanged". This plan replaces the rows with Plan · Phase · Slices · Owner. One of the two is wrong, and a builder of plan 3's column slice will keep `ROW_COLUMNS` for a section this plan removes. State that the plan rows use their own columns and plan 3's sentence covers only the interim.

C. Scope owned twice (misleads). Plan 1's `feature/delivery-my-sprint-scope` (line 137) says it applies the scope to "Release delivery"; this plan's `feature/delivery-sprint-delivery-scope` also builds Sprint delivery scope. Plan 1 open question line 97 already says "Plans 1 and 5 both claim to scope the delivery section", and it is still open. This plan's slice waits on plan 1's but does not say which one narrows the section and which one renames it and groups by sprint. Two slices editing the same filter is a merge collision.

D. Strip states (name only). Design line 79 lists four strip states; Calls Made After Review line 185 lists five and says the strip uses the same five. The plan follows line 185, correctly. Name the later decision as the authority so a builder does not read line 79.

## Left out

- Where Done and To do rows go when `deliveredRows` and `groupPace` (`AgentList.tsx:1377-1378`) still read `view.deliveredRows`; replaced fields are named, these consumers are not.
- A plan in Testing whose slices all merged days ago and a plan in Development share one row form; the plan gives no Phase source or order.
- No rule for a slice with a deferred and a live branch in the strip counts.

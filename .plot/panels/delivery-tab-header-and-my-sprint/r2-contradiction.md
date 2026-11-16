# Round 2 juror: contradiction

Position: amend

## What I read and what I ran

Read: the plan in full, the design spec by grep over its 248 lines (lines 48-70, 172-186, 202-206 read in context), round-1 `panel.md`, and the slice lines and overlapping Approach text of the five sibling plans. Ran: `grep` over every sibling `waits:` marker, `grep -rln "This sprint" packages`, `sed` over `schema.ts:4266-4280`, `ownership.ts:20-31,310-317`, `chip-row.ts:100-120`, `server-info.ts`, `rows.tsx:2280`, `plot-fleet-scan.sh:78-110`, and a grep of `Release:` across the 32 sprint files. No test ran, no board started.

## Wait graph: no cycle

I drew all 20 slices of the six plans, with explicit `waits:` edges and the implicit wave order (`plot-fleet-scan.sh:90`: "A wave is `blocked` by an earlier wave"). Every edge into plan 1 lands on `section-header` (wave 1) or comes from `you-groups`/`tickets-section`/`work-items-gates`, none of which waits on a later plan-1 slice. Plan 5 waits on plan 1 and plan 1 never waits on plans 4 or 5. Every branch named in a marker exists as a slice. No finding on cycles. Cost note: the wave order serialises `delivery-sprint-card` (wave 7) behind the to-do list and the release card, which it does not need, and `sprint-owner-field` (wave 2) behind the section header.

## Contradictions

1. **The five states do not partition the slices once plan 3 lands.** The plan says "at a gate and being built are today's Work items groups" and "the five counts add up to the total". Plan 3 (`delivery-work-items-show-gates.md:44`) moves `stage: 'building'` with no live agent into **Queued**, and keeps another person's approval-owed item in Queued. Queued is none of the five states, and plan 5's mapping table (`delivery-release-progress-per-plan.md:48-53`) has no row for it. `delivery-slice-states` does not wait on `delivery-work-items-gates`, so it classifies against groups that plan 3 then changes. The design (line 185) has the same gap; the plan owns the classification, so it must close it.
2. **Blocked depends on the reader.** "Blocked means the slice sits under You › Blocks delivery", and plan 2 (`delivery-you-blocks-or-feeds.md:63`) places a You row only where `ownership === 'mine'`. A slice blocked on someone else's approval is therefore not "blocked" for me, and the release card's bar, which counts the whole team's release, differs per reader. The plan does not say whether that is intended.
3. **Approve release becomes unreachable with no targeted release.** Today `ReleaseApprove` renders on the release row (`rows.tsx:2280`). The release-card slice removes that row and the `release-approval` You row. The "No release targeted" card binds no version, and a card whose `Release:` value differs from the changesets-computed version shows a disabled button. No sprint is Active on 2026-11-16, and the template ships `Release:` commented out (`templates/sprint.md:13`). So on merge, no Approve button exists anywhere on the tab. The design says "the card is its one place" (line 68), so the card must offer Approve where a release PR exists, whatever the sprints name.
4. **The to-do list "decides no marker itself", yet it does for the release.** After the release-card slice removes `release-approval` from You, the "Approve release <version>" line has no You row to read its marker from. Plan 1 then assigns blocks-delivery itself. The Approach states two things that cannot both be true.
5. **Two plans claim the delivery section's scope.** Plan 1's Done When says "the toggle switches the status card, Release delivery, You and Work items". Plan 5's `delivery-sprint-delivery-scope` claims "With My sprint on, the section's title and plans follow the reader's sprint scope" (line 76). Plan 1 must say that it filters the rows and that plan 5 owns the title and the per-sprint grouping, or drop Release delivery from its own Done When.
6. **Stale citations (rubric 1).** "the same path `readerIsKnown` uses": `ownership.ts:316-317` reads `(reader.hostUser ?? '') !== '' || (reader.gitEmail ?? '') !== ''` and never calls `resolvePerson`. `readerIsKnown` lives in `packages/domain/src/rules/ownership.ts`, and `mine-filter.ts:186` only re-exports it. The chip label "This sprint" comes from `packages/domain/src/rules/chip-row.ts:116,119` and also appears in `AgentList.tsx`, not only in `DeliveryFilters.tsx`. `server-info.ts:170` is `PEOPLE_KEY`; the `parsePersonDirectory` call is at `:179`. `DeliveryFilters.tsx:63-65` records why `data-chip` stayed "This sprint". The rename reverses a recorded decision, and the plan should say so.

## Amend before approval

- Map Queued (and another person's held item) to one of the five states, or add a sixth, and make `delivery-slice-states` wait on `feature/delivery-work-items-gates`. Then fix plan 5's table to match.
- State whether Blocked is reader-relative. If it is not, define it through plan 2's rule applied to the slice's owner, not to the reader.
- Give the release card a binding for an open `changeset-release/` row when no sprint's `Release:` value matches it, and add a Done When line: "an open release PR always has one enabled Approve button".
- Name plan 1 as the owner of the release to-do line's marker.
- Split the delivery-section scope between plans 1 and 5 in both plans' Done When.
- Correct the `readerIsKnown`, `chip-row.ts` and `server-info.ts` citations.

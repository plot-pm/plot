# Juror verdict, round 2: cost lens

Position: amend

## What I read and ran

Read: the plan at `c8075ac6a`, round-1 `cost.md` and `panel.md`, the five sibling plans' slice lines, the Release-progress plan's payload section. Ran (read-only greps and `sed`): `grep -rl 'This sprint' packages test`, `grep -rl 'data-chip="This sprint"'`, `sed` over `schema.ts:4222-4300`, `:853-870`, `:2680-2710`, `chip-row.ts:100-125`, `ownership.ts:19-30`, `server-info.ts:165-179`, `eligible.ts:100-130`, `grep -rln placeDelivery packages/*/src`. Ran no test and did not start the board.

## Findings

1. **The slice-state classification is placed on the payload, but its "blocked" arm is a client-side, filter-dependent answer (main finding).** Plan line 45: *"Blocked means the slice sits under You › Blocks delivery"*; slice line 113: *"as domain facts on the payload"*. `placeDelivery` (`packages/domain/src/rules/delivery-placement.ts:295`) has exactly three callers, all in the client: `AgentList.tsx`, `agent-rows/delivery-view.ts`, `agent-rows/delivery-readings.ts`. No file under `packages/board/src/server` or `packages/fleet/src` calls it. Its `DeliveryInput` takes `mine` and the selected sprints' releases (`delivery-placement.ts:112-118`), both client filter state. To put the five states on the payload, the server must run the placement rule on every fleet tick, without the reader's filters, and the result can then disagree with the You section the reader sees. To derive the five states in the client from the placement the tab already computes costs zero payload and zero server work per tick. The plan prices neither option. The sibling Release-progress plan prices its own share ("about 40 slices ... a few kilobytes", its line 62). This plan gives no payload figure.

2. **Heading order makes plan 1 eight serial merges, and the `waits:` markers suggest a parallelism that does not exist.** `sliceVerdict(readings, priorComplete)` (`eligible.ts:120-123`) holds a slice until every earlier slice is complete. The plan admits this ("Slices run in heading order"). As a result, `feature/sprint-owner-field`, which waits on nothing, sits behind `feature/delivery-section-header`. Each of the eight slices costs one CI round and one review. The longest chain I traced over the six plans is header, owner, fleet card, slice states, to-do, release card, sprint card, scope, then plan 3's `feature/delivery-sprint-delivery-scope` (heading 3, waits on scope): nine serial merges. A cheap fix: move the sprint card above the release card, because the sprint card waits on fewer branches (it has no to-do dependency). Also state the serial count in the plan.

3. **Claims I checked that hold.** The rename counts are correct: 4 browser files (`sprint-switch`, `agents-tab`, `sprint-exempt`, `delivery-filters`) and 3 unit files (`chip-readings.test.ts`, `chip-row.test.ts`, `filtered-estate-totals.test.ts`). One detail is imprecise: only three browser files select `[data-chip="This sprint"]`. `delivery-filters.browser.test.ts` matches the visible text 7 times, so the label `This sprint: <title>` (`DeliveryFilters.tsx:120`) also changes text that tests assert. The rename also touches comments in `AgentList.tsx` (6 lines) and `chip-row.ts`, which the plan does not list. `FleetSprintSchema` is at `schema.ts:4269` and has no `end`. `chip-row.ts:116-117` is the disabled arm. `version` is at `schema.ts:2685-2705`. `releaseVersion` is at `tuple-row.ts:1055`. `sliceProgress` is at `deliverable.ts:302`.

4. **Minor stale references.** `Reader` is at `ownership.ts:19`, and its fields are at `:20-28`, not `:23-30`. `readerIsKnown` is defined in `packages/domain/src/rules/ownership.ts:316`. `mine-filter.ts:186` only re-exports it. `parsePersonDirectory` is called at `server-info.ts:179`, not `:170`.

5. **Host calls: no finding.** The Owner check reuses the `People` directory the server already reads. `end` is already parsed at `sprint-record.ts:78`. The Approve binding reads `AgentRow.version` from the payload. The MoSCoW tier counts can be derived from `SprintMemberSchema.tier` (`schema.ts:866`), which is already on the fleet payload. I found no new host call.

6. **Contract blast radius is small, but the plan does not name it.** `end` on `FleetSprintSchema` touches `mock-fleet.ts:412`, the `fleet.ts:8324` builder, and fixtures. 6 test files name `timeboxLabel`, and 31 board test files carry `sprints:`. A schema default keeps most of them valid. The `/plot-sprint` and template change needs a changeset `bumps:` entry for `plot-sprint`, which the plan does not mention.

## Amend before approving

- Say where the five-state classification is computed. Prefer the client, over `placeDelivery`'s output, and remove "on the payload". If it stays server-side, state the per-tick cost and how filter dependence is handled.
- State the eight serial merges in plan 1, and nine across the set. Put the sprint card before the release card.
- Fix the line references in finding 4. Name the label-text assertions in `delivery-filters.browser.test.ts`, and the `plot-sprint` changeset bump.

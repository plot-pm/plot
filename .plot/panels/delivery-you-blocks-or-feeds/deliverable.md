# Deliverable juror: delivery-you-blocks-or-feeds

Position: amend

## 1. False or unverified claims

- Done When line 4 ("A loose branch shows under Unblock with Release and Delete, both calling their controllers") is already true on main: `delivery-placement.ts:221` places a loose item under `unblock` with reason `loose`, and `packages/board/src/app/components/AgentList.tsx:1165-1171` renders `ReleaseClaimButton` and `LooseDeleteButton` for a loose branch with no PR. The line proves nothing that this plan builds. Changelog line 4 restates current behaviour. The new part is the closed PR whose branch still exists, and no Done When line asserts it.
- "the phase strip ... from the 2026-11-08 design" (plan:37) reads as if it exists. It is specified there (`2026-11-08-delivery-tab-design.md:67`) but not built: `Handed to fleet` occurs zero times under `packages/*/src`. Discovery counts "tickets and stories that no plan answers", and no slice names a story reading.
- The PR rule's first condition needs a reading that the Delivery tab does not take. `humanCommentOpen` (`packages/domain/src/rules/human-comment-open.ts:74`) exists, and only `workflows/merge.ts` calls it. `PrReading` (`delivery-placement.ts:38-41`) holds only `ci` and `review`, and `delivery-readings.ts` reads no conversation. The plan does not name where this reading comes from.
- The open-question chip and "first open question" have no source. No domain rule or board payload carries a plan's Open Questions (grep `openQuestion` over `packages/domain/src`, `packages/board/src/server`: none).
- "You ignores the Mine filter" (plan:45) changes `delivery-placement.ts:337`, which gates You on `mineAllows`. No slice names this change, and no Done When line covers it.

## 2. Slices vs Changelog vs Done When

| Changelog line | Slice (`builds`) |
|---|---|
| three groups + markers | delivery-you-groups (matches its marker) |
| one row per plan, chips, first question | delivery-you-plan-rows (matches its marker) |
| PR rule | delivery-you-groups (described in the slice text, absent from its `builds` marker) |
| Unblock: loose branches and closed PRs, Release/Delete | delivery-you-plan-rows (slice text), but the Unblock group itself is slice 1; neither marker names it |
| tickets out of the rows, header count | delivery-you-groups (slice text, not marker) |

- Each slice ships something visible. Each `builds` marker names only one of the three to five things its slice text lists. Slice 2's marker omits the column change (`ROW_COLUMNS` at `delivery-row-form.ts:13` drops `where` and `by`) and the Unblock rows.
- Done When has no line for: the You header and phase strip, markers (red/blue/grey), Mine-ignoring, the Kind · Item · Status · Do · Age columns, or the closed-PR Unblock case.
- Done When line 1 (no repeated reason sentence) depends on both slices. Slice 1 regroups `REASON_WORDS` (`delivery-view.ts:43-56`). Slice 2 builds the Status column that `REASON_STATUS` (`delivery-row-form.ts:226`) fills.

## 3. Most serious gap

The two slices cannot be built in parallel, although both carry only `waits: feature/delivery-section-header`. Both edit `delivery-row-form.ts`. Slice 1 changes `YouGroup`/`YouReason`, which drive `rowShape` (`:162-166`) and `REASON_STATUS` (`:226`). Slice 2 rewrites `ROW_COLUMNS` and the `do` cell (`:290`). Both also edit `delivery-view.ts` (group labels `:32-33`, reason words `:43-56`) and the You branch of `AgentList.tsx` (`:1160-1171`). Slice 2's Unblock rows need slice 1's Unblock-only group and the closed-PR loose case. A builder on slice 2 builds against groups that slice 1 is removing, and the two PRs conflict in the same functions.

## 4. Changes

- Add `<!-- waits: feature/delivery-you-groups -->` to `feature/delivery-you-plan-rows`, or move the Unblock rows and columns into slice 1 and keep slice 2 to the one-row plan form and its chips.
- Name the readings to be built: a PR-conversation reading for the Delivery tab (reuse `humanCommentOpen`) in slice 1, and a plan Open Questions count and first line in the board payload for slice 2. Name the story/Discovery count source for the phase strip, or move the strip to its own slice.
- Name the Mine change at `delivery-placement.ts:337` in slice 1, and add a Done When line: "You shows the same rows in every Mine mode".
- Replace Done When line 4 with the new behaviour: "A closed PR whose branch still exists shows under Unblock with Release and Delete." Add Done When lines for the markers, the columns and the You header counts.
- Widen each `builds` marker to cover the PR rule (slice 1) and the column set and Unblock rows (slice 2), or split the slices so that each marker covers its slice.
- Resolve with plan 1 (`delivery-tab-header-and-my-sprint.md:71`) which slice owns the marker field the to-do list reads, and declare that order in both plans.

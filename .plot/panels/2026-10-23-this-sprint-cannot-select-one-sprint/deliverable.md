Position: amend

Lens: deliverable. Each slice must ship something a reviewer can check, the order must be workable, and the Changelog must describe what the slices build. The two-slice shape (domain, then board) is workable and needs no server or payload field for the core behaviour. Five findings stop it from being approvable as written.

## Findings

1. **Slice 1 changes a reading the domain does not compute.** The plan says `inSprint` "becomes true for a row ... in the selected sprint" (plan:39) as a slice-1 domain change (plan:56). `inSprint` is an INPUT to `chipRow`: `SprintChipReadings.visibleRows: { inSprint: boolean }[]` (chip-row.ts:37). The caller computes it in the component against every Active slug: `inSprint: rowIsSprintExempt(r) || slugPassesSprintFilter(r.plan, allSprintSlugs, membership)` (AgentList.tsx:694-701). The row filter that actually hides rows is also in the component (AgentList.tsx:660-663) and in `lib/filters.ts:309` (`slugPassesSprintFilter`). A slice-1 PR that touches only `@plot-pm/domain` cannot change which rows are hidden or what the hidden count means. Open point: either slice 1 moves the membership decision (`slugPassesSprintFilter` + `rowIsSprintExempt`) into the domain so `chipRow` reads the selection and the rows, or the plan states that row membership is a slice-2 caller change and removes it from slice 1.

2. **The selection state already holds a subset, so the stated "current behaviour" is narrower than the code.** `sprintFilter` is a `Set<string>` (AgentList.tsx:566). `sanitizeSelection` already drops stale slugs (filters.ts:165-168, AgentList.tsx:625-628), and `slugPassesSprintFilter(r.plan, selectedSprints, membership)` already filters on any subset (AgentList.tsx:663). Only the toggle (AgentList.tsx:639) and the chip readings (`allSprintSlugs`, :694) are all-or-nothing. The proposed "selected slug, or none; a stale slug reads as none" (plan:38) re-decides what `sanitizeSelection` already decides. Open point: does the domain rule replace `sanitizeSelection` for this tab (one rule), or is the plan adding a second stale-slug rule? A single-slug reading also discards the subset shape the state already has. Decide one slug or a subset before slice 1.

3. **Open Question 1 already has an answer, and the persistence slice misnames who finds it.** The Delivery tab's sprint selection is persisted nowhere: `useState(() => new Set())` with the comment "NOT SYNCED TO URL" (AgentList.tsx:561-566). The board has two conventions. View state goes in the URL: the Planning tab's `?sprint=` (App.tsx:284, :1040 via `readList`/`writeList`, filters.ts:197-211). Per-viewer convenience goes in `localStorage` under `plot-board:agents:*`: `collapse.ts:22-40` and `mine-filter.ts:4-17`. The schema states the rule: "*view state in the URL, convenience in localStorage*" (schema.ts ~4497). `mine-filter.ts:7-11` argues a row-hiding filter is not worth sharing, so it uses `localStorage`. The sprint selection is the same kind of state. Open point: confirm `localStorage` with a key such as `plot-board:agents:sprint`, with the `mine-filter.ts` failure discipline (any read failure yields "all Active sprints"). The plan says "The first slice finds that store" (plan:43), but persistence is in slice 2 (plan:60). Move the sentence, or answer it now and delete the Open Question.

4. **The row-slug property cannot be rendered from what slice 1 names.** The plan names one domain boolean, "rows show their slug while >1 sprint is Active" (plan:41). The row also needs WHICH slug or slugs it belongs to. The only reliable source is the sprint-file membership (`sprintMembershipLookup`, filters.ts:24, AgentList.tsx:587-590). `r.sprint` is the back-reference field that the plan `the-sprint-filter-says-what-it-filters` measured as empty on 53 rows (AgentList.tsx:581-586). The map runs sprint → plans, not plan → sprints. Open point: slice 1 must also build "the sprint slugs of this row" as a domain property, from membership and not from `r.sprint`. That property answers Open Question 2 (one row in two sprints) by construction, since it returns a list. Otherwise the slice-2 component decides the slug, which breaks *Every rendered state is a domain property*.

5. **Consumers of the selection that neither slice names.** Slice 2's reviewer needs this list to check completeness:
   - `workersHiddenByFilter` (AgentList.tsx:738-746). It already reads `selectedSprints`, so it follows a subset automatically. Its WORKING "(N hidden by filter)" note gets no test.
   - `unfilteredSectionedRows` / `unfilteredNote(..., sprintFilterOn)` (AgentList.tsx:1031-1033, :1245-1248). These are the per-section "hidden by sprint" accounting from `a-sprint-view-says-what-it-hid`.
   - `sprintExempt={sprintFilterOn && rowIsSprintExempt(r)}` (AgentList.tsx:2321) and `sprint-exempt.browser.test.ts`.
   - `delivery-filters.browser.test.ts`. It asserts the current `data-sprint-report` lines and the chip, and it will change.

   Open point: list these in slice 2, and state for each whether it follows the selected sprint or every Active sprint.

## Order and markers

6. **Slice 2 carries no `waits:` marker.** The precedent plan's board slice carries `<!-- waits: feature/chip-row-states-are-domain-properties -->` (2026-10-19-one-chip-row-and-a-sprint.md:84). Slice 2 here uses the new `chipRow` readings and the row-slug property, so it cannot compile against `main` before slice 1 merges. Open point: add `<!-- waits: feature/this-sprint-selects-one-sprint-rule -->` to slice 2, and widen slice 1's `builds:` to name every property slice 2 consumes (selection reading, label, row slugs).

7. **Open Question 3 (estate totals) means a server change that no slice builds.** `estateTotals` is computed on the server (fleet.ts:7066, :7187, :7445) and rendered unfiltered (DeliveryFilters.tsx:93-96). The selection is per viewer and client-side, so the server cannot scope totals to it. Open point: decide "rows only" now, or add a slice that derives the totals client-side from domain counts. Leaving the question open hides a third slice.

## Changelog

8. Changelog line 1 (plan:17) matches what slice 2 ships, with one condition: Open Question 3 must resolve to "rows only". Line 2 (plan:18) says "show their sprint slug". If finding 4 resolves as a list, a row in two sprints shows both slugs, and the line should say "slug(s)" or state the rule. Neither line names the changed chip label (plan:40). Add it, because a reviewer checks the label. The `Board impact` line (plan:20) omits the `@plot-pm/domain` change and the `pnpm build:board` rebuild that the precedent plan names.

9. Open Question 4 (no sprint page) carries over unchanged from the precedent plan's Open Question 3. The note at DeliveryFilters.tsx:99-108 still holds. A click that selects a filter navigates nowhere, so it needs no new answer. The plan can mark it answered.

## Siblings

None of the seven siblings touches the chip row, `AgentList.tsx` or the sprint filter. Their only "sprint" hits are the empty `**Sprint:**` status field. No ordering conflict.

## Read / Ran

**Read:** the subject plan (whole); `packages/domain/src/rules/chip-row.ts` (whole); `packages/board/src/app/components/AgentList.tsx:555-760` plus grep hits at 345, 389, 958-962, 1028-1066, 1243-1248, 2321; `DeliveryFilters.tsx` (sprint grep, 80-125); `lib/filters.ts:160-215` plus the export list; `lib/agent-rows/collapse.ts:1-50`; `lib/agent-rows/mine-filter.ts:1-50`; `contract/schema.ts:4480-4520` and the `estateTotals`/`FleetSprintSchema` lines; `server/fleet.ts` `estateTotals` grep; `App.tsx` `readList`/`writeList` grep; `docs/plans/2026-10-19-one-chip-row-and-a-sprint.md:20-100`; the Approved sibling and six Draft siblings (grep for sprint/chip/AgentList). Located `packages/domain/test/chip-row.test.ts`, `delivery-filters.browser.test.ts` and `sprint-exempt.browser.test.ts` by grep, without reading them in full.

**Ran:** `pnpm --filter @plot-pm/domain exec vitest run test/chip-row.test.ts`. It failed with "vitest not found" because the worktree has no `node_modules`. No install was done, so no test result backs these findings. Every claim above comes from reading.

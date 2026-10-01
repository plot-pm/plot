# An open board follows a sprint change

> The Agents tab keeps its «Sprint only» selection in memory. When the selected sprint closes, the selection still filters every row against it, while the control shows only the new sprint, unchecked. Every plan row stays hidden until a reload, the closed sprint's own members included.

## Status

- **State:** Delivered
- **Approved:** 2026-10-01, jwloka, in-session
- **Started:** 2026-10-01, jwloka, `bug/a-closed-sprint-stops-filtering`
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1145
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2
- **Delivered:** 2026-10-02

## Changelog

- The Agents tab stops filtering on a sprint that is no longer active, and forgets that selection. A board left open across a sprint change shows every plan row without a reload, and the «Sprint only» control and the filter always agree.

Board impact: one `@plot-pm/board` patch. No payload, schema or plan-format change.

## Motivation

Measured 2026-10-01 on `localhost:7777`:

1. The page loaded while `plot-observes-and-recovers-its-own-fleet` was the active sprint, and «Sprint only» had been checked for it.
2. That sprint closed (`bd14adec`), and `the-fleet-runs-through-its-limits` started (`3f916d15`). Three Draft plans with six slices joined it.
3. `/api/fleet` carried all six rows in `group: waiting-on-you`, read at `ea8f88d5`, `ready: true`.
4. The board printed `6 rows hidden` and `WAITING ON YOU (18) — 6 hidden by Sprint only`, with the only checkbox unchecked, and rendered none of the six rows.
5. A browser reload showed all six.

A panel juror reproduced it on the artifact built from `63893100` with a stubbed fleet: after the switch the control showed `sprint-b` unchecked, 2 rows were hidden and 0 were shown. **Every plan row is hidden, not only the new sprint's**, because the closed slug is in no membership entry, so the closed sprint's own member row fails the filter too.

**The cause, read on `7206c9d8`.** The issue points at `App.tsx:156`, `readList('sprint')`. That is the Plans tab's URL-synced filter, and it is not involved. The Agents tab holds its own selection:

- `AgentList.tsx:524` keeps `sprintFilter` as an in-memory `Set` of sprint slugs. Its comment says it is deliberately not persisted, so a reload clears it. That is why the reload repaired the page.
- `AgentList.tsx:535` builds the control's list from `fleet.sprints`, which carries only **Active** sprints. A closed sprint leaves the list on the next poll, and with it the one checkbox that showed it as selected.
- `SprintFilter.tsx` renders `checked={selected.has(sprint.slug)}` for each listed sprint. The new sprint is not in the `Set`, so its box reads unchecked.
- `AgentList.tsx:570-573` filters whenever `sprintFilter.size > 0`. `slugPassesSprintFilter` (`lib/filters.ts:283`) looks the closed slug up in a membership map built from active sprints only, finds no entry, and fails every plan row. Issues pass because they are not sprint-filtered.

So the control and the filter answer from two different sprint sets: the control from the active sprints, the filter from whatever the reader selected at any time since load.

The Plans tab already solved the same shape with the same rule. `App.tsx:932-937` drops a selected value that matches no current option (`sanitizeSelection`, `lib/filters.ts:165`), with the comment *"an unchecked selection would hide every card (empty board)"*. The Agents tab has no equivalent.

## Design

### Approach

**The existing rule decides which selected sprints still filter.** `sanitizeSelection(selected, options)` (`lib/filters.ts:165`) keeps the selected values that match a current option and collapses an all-invalid selection to no filter. The Plans tab calls it for the same shape (`App.tsx:937`). `AgentList` derives the effective selection once, with `sanitizeSelection([...sprintFilter], activeSprints.map((s) => ({ value: s.slug, label: s.title })))`, and no new rule is added.

Every consumer reads the derived selection. `selectedSprints` (`:569`), today `[...sprintFilter]`, becomes the derived list, and the other sites read it: the filtered rows (`:570`), `sprintReport` (`:579`), `workersHiddenByFilter` (`:624`) and its dependency array (`:631`), `unfilteredSectionedRows` (`:984`), `unfilteredCount` (`:1178`), the exempt mark (`:2225`), and the `selected` prop of `SprintFilter` (`:840`). No consumer reads `sprintFilter.size` after this slice.

**The stored selection is pruned, so a dropped sprint cannot come back.** `activeSprints` comes from the sprint files in the checked-out tree (`workingTreeSprints`, `fleet.ts:7597-7606`), so a branch switch to a tree where the closed sprint is still Active returns it to `fleet.sprints`. A slug kept in the `Set` would then filter again with its box checked, a selection the reader did not make in this view. When the derived selection is shorter than the stored `Set`, `AgentList` replaces the `Set` with the derived one in an effect keyed on `activeSprints`. The derivation covers the render before the effect runs, so no frame filters on a dropped slug.

**An empty sprint list prunes nothing.** `workingTreeSprints` (`board.ts`) answers `[]` when the sprint directory is missing or cannot be read, which a checkout or a fast-forward of the main checkout can cause for one poll. A prune on that answer would delete a live selection that the next poll cannot restore. So the effect prunes only when `activeSprints` holds at least one sprint. While the list is empty, the stored `Set` stays as it is, and the derived selection is empty, so the filter is off for that poll and comes back unchanged on the next one.

**Two selected sprints, one closed, keep the other.** `sanitizeSelection` keeps every selected value that is still an option, so the derived selection and the pruned `Set` hold the sprint that is still active, and the filter keeps filtering on it.

**A new active sprint is not selected automatically.** The reader selected a sprint, not "the current sprint". When the selection empties, the filter is off and the control says so with an unchecked box, which is what it already shows.

### What this does NOT do

- **It does not persist the Agents tab's selection.** The comment at `AgentList.tsx:513-517` records that decision, and this plan keeps it.
- **It does not touch the Plans tab's filter.** That filter is URL-synced and already sanitized.
- **It does not change which sprints `fleet.sprints` carries.**
- **No other view holds this defect.** Searched on `origin/main`: `useState` holding a sprint selection exists at `AgentList.tsx:524` and `App.tsx:156` only. `Board.tsx:197` and `Swimlanes.tsx:137` filter on the `sprintSel` prop, and `App.tsx:1241` and `:1253` pass them `validSprintSel`, which `sanitizeSelection` already derives. `StoriesTab.tsx` reads `story.sprints` for links and filters nothing. The Plans tab's URL selection is derived, not pruned, so a branch switch can re-engage it there; that state is visible in the URL and the dropdown, and this plan leaves it.

## Slices

### A closed sprint stops filtering (Branch: bug/a-closed-sprint-stops-filtering, PR: #1158)

One unit case in the existing `describe('sanitizeSelection')` block of `test/unit/filters.test.ts`, with sprint-shaped options: two selected sprints where one closed keep the other. The block's generic cases already cover a kept value, a dropped value and an empty selection. `AgentList` derives the selection with `sanitizeSelection`, reads it at every site named above, and prunes the stored `Set` in an effect.

A browser test uses the catalogue's `route` option (`test/catalogue/index.ts:77`) with a mutable flag, not a second stub server. The first `/api/fleet` carries sprint A active with member row `bug/a`; the test checks A's box; the next poll carries sprint B active with rows `bug/a` and `bug/b`, and A is gone. Without a reload, the test asserts: both rows are visible, `data-sprint-hidden` is absent, no `hidden by Sprint only` text renders, and B's box is unchecked. The test opens with an empty-list step before the switch: with A checked, one poll serves `sprints: []`, as a missing sprint directory does, and the next serves A active again with member row `bug/a` and a row `bug/b` in no sprint. A's box is still checked, `bug/a` is visible and `bug/b` is hidden, so the empty poll pruned nothing. After the switch to B described above, the flag moves back to A active with member rows `bug/a` and `bug/b`: A's box is unchecked and `bug/b` stays visible, which proves the prune. On `origin/main` this last assertion fails, because the retained slug filters `bug/b` out again.

A second browser test covers two Active sprints: the first payload carries A and B, each with one member row, and the test checks both boxes; the next poll carries B only, with a row of each plus a row in no sprint. The test asserts B's box stays checked, B's member row is visible, and the row in no sprint is hidden, so the filter still runs on B.

The browser-test count pin `EXPECTED_TESTS` in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` (536 on `origin/main`) rises by 2, the two browser tests this slice adds, to 538. A `'@plot-pm/board': patch` changeset.

## Done when

- The sprint-shaped `sanitizeSelection` case passes, `selectedSprints` is the derived list, and `AgentList.tsx` contains no read of `sprintFilter.size`.
- An empty sprint list leaves the stored selection untouched, and the browser test proves it across a `sprints: []` poll.
- Both browser tests pass on the built artifact. The first fails on `origin/main` at the first assertion and at the re-engagement assertion. `EXPECTED_TESTS` reads 538.
- `pnpm run test:board` and `pnpm run typecheck` pass.

## Notes

Found by the operator on 2026-10-01 while reading the new sprint on the board, minutes after the previous sprint was closed in the same session.

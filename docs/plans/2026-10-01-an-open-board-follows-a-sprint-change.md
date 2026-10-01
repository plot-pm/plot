# An open board follows a sprint change

> The Agents tab keeps its «Sprint only» selection in memory. When the selected sprint closes, the selection still filters every row against it, while the control shows only the new sprint, unchecked. The new sprint's rows stay hidden until a reload.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1145
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The Agents tab stops filtering on a sprint that is no longer active. A board left open across a sprint change shows the new sprint's rows without a reload, and the «Sprint only» control and the filter always agree.

Board impact: one `@plot-pm/board` patch. No payload, schema or plan-format change.

## Motivation

Measured 2026-10-01 on `localhost:7777`:

1. The page loaded while `plot-observes-and-recovers-its-own-fleet` was the active sprint, and «Sprint only» had been checked for it.
2. That sprint closed (`bd14adec`), and `the-fleet-runs-through-its-limits` started (`3f916d15`). Three Draft plans with six slices joined it.
3. `/api/fleet` carried all six rows in `group: waiting-on-you`, read at `ea8f88d5`, `ready: true`.
4. The board printed `6 rows hidden` and `WAITING ON YOU (18) — 6 hidden by Sprint only`, with the only checkbox unchecked, and rendered none of the six rows.
5. A browser reload showed all six.

**The cause, read on `7206c9d8`.** The issue points at `App.tsx:156`, `readList('sprint')`. That is the Plans tab's URL-synced filter, and it is not involved. The Agents tab holds its own selection:

- `AgentList.tsx:524` keeps `sprintFilter` as an in-memory `Set` of sprint slugs. Its comment says it is deliberately not persisted, so a reload clears it. That is why the reload repaired the page.
- `AgentList.tsx:535` builds the control's list from `fleet.sprints`, which carries only **Active** sprints. A closed sprint leaves the list on the next poll, and with it the one checkbox that showed it as selected.
- `SprintFilter.tsx` renders `checked={selected.has(sprint.slug)}` for each listed sprint. The new sprint is not in the `Set`, so its box reads unchecked.
- `AgentList.tsx:570-573` filters whenever `sprintFilter.size > 0`. `slugPassesSprintFilter` (`lib/filters.ts:283`) looks the closed slug up in a membership map built from active sprints only, finds no entry, and fails every plan row. Issues pass because they are not sprint-filtered.

So the control and the filter answer from two different sprint sets: the control from the active sprints, the filter from whatever the reader selected at any time since load.

The Plans tab already solved the same shape. `App.tsx:932-937` drops a selected value that matches no current option (`sanitizeSelection`, `lib/filters.ts:165`), with the comment *"an unchecked selection would hide every card (empty board)"*. The Agents tab has no equivalent.

## Design

### Approach

**One pure rule decides which selected sprints still filter.** `activeSprintSelection(selected, activeSprints)` in `packages/board/src/app/lib/filters.ts`, beside `slugPassesSprintFilter` and `sanitizeSelection`, returns the selected slugs that name an active sprint, in the order of `activeSprints`. A slug no active sprint carries is dropped. An empty result means no filter.

`AgentList` derives the effective selection once, from the stored `Set` and `fleet.sprints`, and every consumer reads it: the filtered rows (`:570`), `sprintReport` (`:579`), `workersHiddenByFilter` (`:624`), `unfilteredSectionedRows` (`:984`), `unfilteredCount` (`:1178`), the exempt mark (`:2225`), and the `selected` prop of `SprintFilter`. The stored `Set` is left as the reader's input; the rule decides what it means against the current payload. No consumer reads `sprintFilter.size` directly after this slice.

**A new active sprint is not selected automatically.** The reader selected a sprint, not "the current sprint". When the selection empties, the filter is off and the control says so with an unchecked box, which is what it already shows.

### What this does NOT do

- **It does not persist the Agents tab's selection.** The comment at `AgentList.tsx:513-517` records that decision, and this plan keeps it.
- **It does not touch the Plans tab's filter.** That filter is URL-synced and already sanitized.
- **It does not change which sprints `fleet.sprints` carries.**

## Slices

### A closed sprint stops filtering (Branch: bug/a-closed-sprint-stops-filtering)

`activeSprintSelection` with unit tests: a selected active sprint is kept; a selected slug absent from `activeSprints` is dropped; two selected sprints where one closed keep the other; an empty selection stays empty. `AgentList` reads the derived selection at every site named above. A browser test stubs `/api/fleet`: the first payload carries sprint A active with a plan row in it; the reader checks «Sprint only»; the next payload carries sprint B active with a different plan row, and A is gone. The test asserts the B row is visible, no `hidden by Sprint only` text renders, and B's box is unchecked, all without a reload. The browser-test count pin in `stubbed-tests-start-no-board.test.ts` rises by one. A `'@plot-pm/board': patch` changeset. <!-- builds: activeSprintSelection, the rule for which selected sprints still filter -->

## Done when

- `activeSprintSelection` is unit-tested for the four cases above, and `AgentList.tsx` contains no read of `sprintFilter.size` outside the derivation.
- The browser test passes on the built artifact and fails on `origin/main` at `7206c9d8`.
- `pnpm run test:board` and `pnpm run typecheck` pass.

## Notes

Found by the operator on 2026-10-01 while reading the new sprint on the board, minutes after the previous sprint was closed in the same session.

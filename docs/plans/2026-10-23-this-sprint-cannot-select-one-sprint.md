# Board: «This sprint» cannot select one sprint when several are active

> With several sprints Active, the Delivery tab's «This sprint» chip shows the items of all of them; the chip gains a way to choose one sprint, and rows name their sprint while more than one is active.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2399
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- The board's «This sprint» chip selects one named sprint when several sprints are Active, and the choice persists per viewer.
- Delivery rows show their sprint slug while more than one sprint is Active.

Board impact: changes the Delivery tab's chip row and row rendering in `@plot-pm/board`. No change to the plan format, the template or the helper scripts.

## Motivation

Observed 2026-10-23 in ewz-kus-portal (board on :7778, Plot 2.28.0). Two sprints are Active against one release: `kus-portal-103` (owner Jan, 2026-10-23 → 2026-11-06) and `kus-portal-103-markus` (owner Markus, 2026-10-23 → 2026-10-25). With «This sprint» on, the Not started and Quiet lists show the five plans of `kus-portal-103-markus` to a reader who wants only their own sprint, and no row says which sprint it belongs to.

«Mine» is not a substitute: it filters by person, not by sprint, and a sprint can hold items of several people.

Parallel sprints per person or per sub-team against one release are a normal shape. The chip's name asks for one sprint and answers with every Active sprint.

## Design

### Approach

Today `sprintChip` in `packages/domain/src/rules/chip-row.ts` reads `hasActiveSprint` and a per-row `inSprint` flag. The chip is on or off, and `inSprint` is true for a row in any Active sprint. `DeliveryFilters.tsx` already renders one line per Active sprint (`data-sprint-report`), so the header names every sprint but cannot select one.

Proposed shape, all decided in the domain package so a unit test asserts it (CLAUDE.md, *Every rendered state is a domain property*):

- **A selection reading.** The chip's readings gain the selected sprint slug, or none for "all Active sprints" (today's behaviour). A slug that names no Active sprint reads as none.
- **Row membership.** `inSprint` becomes true for a row when no sprint is selected and the row is in any Active sprint, or when the row is in the selected sprint.
- **Chip label.** With one sprint selected the label names it. With one Active sprint, or none selected, the label stays `This sprint`.
- **Row sprint slug.** A domain property says whether rows show their sprint slug: true while more than one sprint is Active. The row component renders it and decides nothing.
- **Selection UI.** The sprint lines in the header become the control: a click selects that sprint, and a click on the selected sprint returns to all Active sprints.
- **Persistence per viewer.** The selection is stored where the board already stores per-viewer filter state. The first slice finds that store; if none exists, the choice is an Open Question below.

### Open Questions

- [ ] Where does the board store per-viewer filter state today (browser storage, URL, server)? The persistence slice follows that answer and adds no second store.
- [ ] A row in two Active sprints: does it show both slugs, or the first? Measure whether this occurs before deciding.
- [ ] Does the selected sprint also scope the estate totals in `DeliveryFilters` (`estateTotals`), or only the rows?
- [ ] The existing note that the sprint name is not a link (`DeliveryFilters.tsx`, "the board has no sprint page today") stays true: the click selects a filter and navigates nowhere. Confirm that is acceptable.

## Slices

### Selection rule

- `feature/this-sprint-selects-one-sprint-rule` — chip-row readings, row membership, label and the row-slug property in `@plot-pm/domain`, with unit tests for 0, 1 and 2 Active sprints and a stale selected slug <!-- builds: sprint selection in chipRow -->

### Board UI

- `feature/this-sprint-selects-one-sprint-ui` — clickable sprint lines, row slug rendering and per-viewer persistence in `@plot-pm/board`, with one browser test per behaviour

## Notes

Filed as plot-pm/plot#2399 from a Claude Code session. The plan's `Issue:` field is the only link to the issue; nothing was written to the tracker.

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
- **Rounds:** 1

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

## Open Points

Round 1 was a four-lens panel (estate, contradiction, deliverable, cost); all four jurors hold `amend`. Verdicts and moderation: `.plot/panels/2026-10-23-this-sprint-cannot-select-one-sprint/`.

- [ ] [Domain] Is this a regression of #2137 rather than a feature? `AgentList.tsx:566` still holds `sprintFilter: Set<string>`, `sanitizeSelection` (`lib/filters.ts:165`) already drops a stale slug, and `slugPassesSprintFilter` (`lib/filters.ts:309`) already filters by a subset. #2137 (`f19611d58`) removed the per-sprint checkboxes and dropped the subset test without a plan deciding it. Decide `Type:` (`feature` or `bug`) and whether the dropped test returns. — *held by: estate, contradiction, deliverable, cost*
- [ ] [Domain] One sprint, or a subset? The plan proposes one selected slug or none; the state already holds any subset. Decide whether the chip selects one sprint or restores the subset selection #2137 removed. — *held by: estate, deliverable, cost*
- [ ] [Technical] Where is membership decided? `chipRow` only counts `!row.inSprint` (`chip-row.ts:85`); the board computes `inSprint` (`AgentList.tsx:697-701`) and the filter (`:660-663`). Decide: move `slugPassesSprintFilter`, `rowIsSprintExempt` and `sanitizeSelection` into `@plot-pm/domain` (the Board tab and Swimlanes share them), or keep a caller-supplied boolean and declare the duplicate with a corpus test. Slice 1 as written changes no hidden row. — *held by: all four; contradiction and cost differ on the choice*
- [ ] [Domain] Persist the selection at all? `AgentList.tsx:553-565` records it as NOT PERSISTED and NOT SYNCED TO URL, and the Released plan `2026-10-01-an-open-board-follows-a-sprint-change` keeps that. The Changelog line "persists per viewer" reverses it without citing it. Decide whether to reverse it; if yes, cite the decision and update the comment. — *held by: contradiction, estate, cost*
- [ ] [Technical] If persisted: URL or localStorage? The Planning tab keeps its sprint selection in the URL (`App.tsx:284`, `:1040`); `mine-filter.ts:4-17` keeps reader-relative state in localStorage (`schema.ts:4498`, "view state in the URL, convenience in localStorage"). Decide whether a sprint selection is a shareable view or a personal convenience. — *divided: contradiction says URL; deliverable and cost say localStorage*
- [ ] [UX] Does the sprint line become the control? `2026-10-19-one-chip-row-and-a-sprint` (#2080) made the sprint line report only, and its "the sprint name links to the sprint" stays unbuilt (`DeliveryFilters.tsx:105-108`). Decide: selection in the chip row (a split chip, or one chip per Active sprint while more than one is Active), or reverse #2080 for the sprint line. — *held by: contradiction*
- [ ] [Domain] Which slug does a row in two Active sprints show? `AgentRow.sprint` is one slug, set by the server from the sprint file, and the first Active sprint wins (`schema.ts:2556-2560`, `fleet.ts:6059`); the filter reads the full membership map. With the second sprint selected, such a row shows the first slug. Decide: first-wins (no payload change) or a list of slugs on the payload. Check first whether the five `kus-portal-103-markus` plans in ewz-kus-portal are also members of `kus-portal-103`. — *divided: cost says read `row.sprint`; deliverable says a membership list*
- [ ] [Technical] The label change breaks `[data-chip="This sprint"]` (`DeliveryFilters.tsx:54`) in four browser test files (sprint-switch, sprint-exempt, agents-tab `:4417`, delivery-filters). Decide: a stable `data-chip` key, or a label that stays fixed. — *held by: cost*
- [ ] [Technical] Slice 2 names none of the other readers of the selection: `workersHiddenByFilter` (`AgentList.tsx:738`), the per-section hidden counts (`:1031`, `:1245`), `unfilteredSectionedRows`, and the exempt mark (`:2321`). Add them to the slice and its tests, and add `<!-- waits: feature/this-sprint-selects-one-sprint-rule -->` to slice 2. — *held by: deliverable, estate*
- [ ] [Non-functional] Test cost: "one browser test per behaviour" means three new board-server starts against one in the precedent plan. Decide whether persistence and the stale-slug case are unit tests and the UI slice carries one browser test (the one #2137 dropped). — *held by: cost*
- [ ] [Domain] Estate totals: `estateTotals` is computed on the server with no filter (`fleet.ts:7066`), so scoping it to one viewer's selection needs work no slice holds. Decide "rows only", or add a slice. — *held by: deliverable, cost, estate*
- [ ] [Domain] The plan settles item 12 of `docs/stories/plot-works-in-five-phases/STORY-plot-works-in-five-phases.md:64` (more than one Active sprint; default is the union). Link the story item and record the decision in its Decisions table on approval. — *held by: contradiction*
- [ ] [Domain] The Planning tab gates its sprint badge on `sprintSel.length === 0` in `Board.tsx:177` and `Swimlanes.tsx:124`. Decide whether the Delivery tab's row-slug property and that badge rule are one domain property. — *raised by the moderation; no juror decided it*

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Panel round 1: estate, contradiction, deliverable, cost lenses", "a": "unanimous amend; 13 open points, 2 divided", "category": "panel"}
  ],
  "deferredItems": [
    {"q": "Regression of #2137 or feature?", "category": "domain", "context": "Status Type, Slices"},
    {"q": "One sprint or a subset?", "category": "domain", "context": "Design, Approach"},
    {"q": "Membership predicate in domain or declared duplicate?", "category": "technical", "context": "Selection rule slice"},
    {"q": "Persist the selection at all?", "category": "domain", "context": "Changelog, Persistence bullet"},
    {"q": "URL or localStorage?", "category": "technical", "context": "Persistence bullet"},
    {"q": "Sprint line as control vs #2080", "category": "ux", "context": "Selection UI bullet"},
    {"q": "Row slug for a plan in two sprints", "category": "domain", "context": "Row sprint slug bullet"},
    {"q": "data-chip selector breaks with label change", "category": "technical", "context": "Chip label bullet"},
    {"q": "Other readers of the selection; waits marker", "category": "technical", "context": "Board UI slice"},
    {"q": "Browser vs unit test cost", "category": "nonFunctional", "context": "Board UI slice"},
    {"q": "Estate totals scope", "category": "domain", "context": "Open Questions"},
    {"q": "Story item 12 link", "category": "domain", "context": "Status Story"},
    {"q": "Planning tab badge rule vs Delivery row slug", "category": "domain", "context": "Row sprint slug bullet"}
  ],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

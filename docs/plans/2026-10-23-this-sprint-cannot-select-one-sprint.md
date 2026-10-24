# Board: «This sprint» cannot select one sprint when several are active

> With several sprints Active, the Delivery tab's «This sprint» chip shows the items of all of them. #2137 removed the per-sprint selection that the board state still holds; this plan restores the subset selection in the chip row, keeps it in the URL, and moves the sprint filter rules into the domain.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bugfix-2-28-2
- **Issue:** #2399
- **Story:** plot-works-in-five-phases
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2413 merged
- **Started:** 2026-10-23, jwloka, `bug/this-sprint-selects-a-sprint-subset-rule`
- **Started:** 2026-10-24, Jan Wloka, `bug/this-sprint-selects-a-sprint-subset-ui`

## Changelog

- The Delivery tab's «This sprint» chip selects one or more of the Active sprints again; #2137 had removed that selection.
- The sprint selection is part of the board URL, so a link to the board opens with the same sprints selected.
- Delivery rows show their sprint slug while more than one sprint is Active and the selection is not exactly one sprint.

Board impact: changes the Delivery tab's chip row and row rendering in `@plot-pm/board`, and moves three sprint filter rules from `packages/board/src/app/lib/filters.ts` into `@plot-pm/domain`. No change to the plan format, the template or the helper scripts.

## Motivation

Observed 2026-10-23 in ewz-kus-portal (board on :7778, Plot 2.28.0). Two sprints are Active against one release: `kus-portal-103` (owner Jan, 2026-10-23 → 2026-11-06) and `kus-portal-103-markus` (owner Markus, 2026-10-23 → 2026-10-25). With «This sprint» on, the Not started and Quiet lists show the five plans of `kus-portal-103-markus` to a reader who wants only their own sprint, and no row says which sprint it belongs to. The two sprints share no plan.

«Mine» is not a substitute: it filters by person, not by sprint, and a sprint can hold items of several people.

This is a regression. `AgentList.tsx:566` still holds `sprintFilter: Set<string>`, `sanitizeSelection` (`lib/filters.ts:165`) still drops a stale slug, and `slugPassesSprintFilter` (`lib/filters.ts:309`) still filters by a subset. #2137 (`f19611d58`) removed the per-sprint checkboxes that set that state and removed the subset test, and no plan decided that removal.

## Design

### Approach

1. **The rules move into the domain.** `slugPassesSprintFilter`, `rowIsSprintExempt` and `sanitizeSelection` move from `packages/board/src/app/lib/filters.ts` to `@plot-pm/domain` as arrow functions with unit tests. The Delivery tab, the Board tab and Swimlanes import them from the domain. No board copy remains, so no corpus pair is needed.
2. **The selection is a subset.** The selection is a set of Active sprint slugs. An empty set means all Active sprints, which is today's behaviour. `sanitizeSelection` drops a slug that names no Active sprint, so a stale URL reads as all Active sprints.
3. **Row membership.** `inSprint` is true for a row when the selection is empty and the row is in any Active sprint, or when the row is in a selected sprint. The domain computes it; `AgentList.tsx:697-701` and `:660-663` call the domain instead of computing it.
4. **The control stays in the chip row.** #2080 (`2026-10-19-one-chip-row-and-a-sprint`) made the sprint line in the header report only, and this plan keeps that. While more than one sprint is Active, the chip row shows one toggle chip per Active sprint beside «This sprint». A click toggles that sprint in the selection. With one Active sprint, the chip row is unchanged.
5. **The chip keeps a stable key.** The «This sprint» chip keeps `data-chip="This sprint"`, and each per-sprint chip carries `data-chip="sprint:<slug>"`. The label of the «This sprint» chip names the sprint when exactly one is selected; the `data-chip` value does not change with the label. The four browser test files that select `[data-chip="This sprint"]` keep working.
6. **The selection lives in the URL.** The Planning tab already keeps its sprint selection in the URL (`App.tsx:284`, `:1040`), and `schema.ts:4498` states the rule: view state in the URL, convenience in localStorage. A sprint selection is a view, so it is a URL parameter. This reverses the NOT SYNCED TO URL note at `AgentList.tsx:553-565`, which the Released plan `2026-10-01-an-open-board-follows-a-sprint-change` kept; slice 2 updates that comment and cites this plan. An open board still follows a sprint change: a slug that leaves the Active set drops out through `sanitizeSelection`.
7. **Row sprint slug.** A domain property says whether rows show their sprint slug: true while more than one sprint is Active and the selection does not hold exactly one sprint. The row shows `AgentRow.sprint`, the one slug the server sets from the sprint file (`schema.ts:2556-2560`, `fleet.ts:6059`). The payload does not change. A row in two Active sprints shows the first sprint; the ewz sprints that motivate this plan share no plan, so this case is not measured.
8. **Estate totals are not scoped.** `estateTotals` (`fleet.ts:7066`) stays unfiltered. The selection scopes rows and the per-section hidden counts only.
9. **The Planning tab badge is a separate reader.** `Board.tsx:177` and `Swimlanes.tsx:124` gate the Planning tab's sprint badge on `sprintSel.length === 0`. That rule stays as it is; slice 2 does not change the Planning tab.

## Slices

### Selection rule

- `bug/this-sprint-selects-a-sprint-subset-rule` — move `slugPassesSprintFilter`, `rowIsSprintExempt` and `sanitizeSelection` into `@plot-pm/domain`, add the row-membership rule and the row-slug property, with unit tests for 0, 1 and 2 Active sprints, a subset of two, and a stale selected slug; the board imports the moved rules with no behaviour change → #2466 <!-- builds: sprint selection in chipRow -->

### Board UI

- `bug/this-sprint-selects-a-sprint-subset-ui` — per-sprint toggle chips, the URL parameter, the chip label and the row slug in `@plot-pm/board`. The slice covers every reader of the selection: `workersHiddenByFilter` (`AgentList.tsx:738`), the per-section hidden counts (`:1031`, `:1245`), `unfilteredSectionedRows` and the exempt mark (`:2321`). URL parse and the stale-slug case are unit tests; one browser test restores the subset test #2137 removed → #2469 <!-- waits: bug/this-sprint-selects-a-sprint-subset-rule -->

## Notes

Filed as plot-pm/plot#2399 from a Claude Code session. The plan's `Issue:` field is the only link to the issue; nothing was written to the tracker.

The plan settles item 12 of `docs/stories/plot-works-in-five-phases/STORY-plot-works-in-five-phases.md:64` (more than one Active sprint; the default is the union). On approval, the story's Decisions table records: the default stays the union, and the Delivery tab selects a subset.

## Decisions

Round 1 was a four-lens panel (estate, contradiction, deliverable, cost); all four jurors held `amend`. Verdicts and moderation: `.plot/panels/2026-10-23-this-sprint-cannot-select-one-sprint/`. Jan decided the four domain points on 2026-10-23; the plan author settled the rest.

| Point | Decision | By |
|---|---|---|
| Regression of #2137 or feature | Regression; `Type: bug`, and the removed subset test returns | Jan |
| One sprint or a subset | A subset, as the state already holds | Jan |
| Persist the selection | Yes, in the URL; the `AgentList.tsx:553-565` comment is updated | Jan |
| URL or localStorage | URL — a sprint selection is a view | Jan |
| Sprint line as control or chip row | Chip row; #2080 stays | Jan |
| Where membership is decided | The three rules move into `@plot-pm/domain` | Jan |
| Row slug for a row in two sprints | `AgentRow.sprint`, first wins; the ewz sprints share no plan | Jan |
| `data-chip` selector | Stable key `This sprint`, per-sprint chips `sprint:<slug>` | author |
| Other readers of the selection | Named in slice 2, which waits on slice 1 | author |
| Browser versus unit test cost | Unit tests for URL and stale slug; one browser test | author |
| Estate totals | Rows and hidden counts only | author |
| Story item 12 | Linked in `Story:` and recorded on approval | author |
| Planning tab badge rule | A separate reader; unchanged | author |

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Panel round 1: estate, contradiction, deliverable, cost lenses", "a": "unanimous amend; 13 open points, 2 divided", "category": "panel"},
    {"q": "Regression or feature; subset; URL; chip row; domain rules", "a": "regression (bug); subset; URL; chip row keeps #2080; rules move to the domain; AgentRow.sprint suffices", "category": "domain"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

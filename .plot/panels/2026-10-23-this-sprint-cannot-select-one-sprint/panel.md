# Panel: this-sprint-cannot-select-one-sprint

- **Subject:** docs/plans/2026-10-23-this-sprint-cannot-select-one-sprint.md (Draft, issue #2399, plan PR #2413)
- **Caller:** /challenge-the-plan Phase 3P, round 1
- **Commitment:** `Position: proceed|amend|reject`
- **Lenses:** estate, contradiction, deliverable, cost
- **Gate:** `plot-panel.mjs check` exit 0 for all four; no send-back
- **Reconcile:** `unanimous amend estate,contradiction,deliverable,cost`
- **Siblings:** 7 named, 6 read, 1 unread. No sprint is Active in this repo, so the set is the unfinished plans: `2026-10-23-one-pr-reader-per-machine-and` (Approved) and six plan-PR Drafts. `origin/idea/plot-approve-reports-no-pr-found` was not found on the remote by the contradiction juror. No juror found an overlap with a sibling.

## Agreement

All four jurors hold `amend`, and all four reach it from the same three facts:

1. **The selection machinery already exists.** `AgentList.tsx:566` holds `sprintFilter: Set<string>`. `sanitizeSelection` (`lib/filters.ts:165`, used at `AgentList.tsx:625`) already drops a stale slug, and `slugPassesSprintFilter` (`lib/filters.ts:309`) already filters by any subset. Only `toggleThisSprintChip` (`:639`) and the `allSprintSlugs` readings (`:694-701`) are all-or-nothing. #2137 (`f19611d58`) removed the per-sprint checkboxes and dropped the subset test, and the plan `2026-10-19-one-chip-row-and-a-sprint` never decided that. The plan describes this as new work and proposes a single slug, which drops the subset the state already holds.
2. **Slice 1 cannot change behaviour alone.** `chipRow` only counts `!row.inSprint` (`chip-row.ts:85`). The board computes `inSprint` and the filter itself. A domain-only slice changes the count and not which rows are hidden.
3. **Open Questions 1 and 2 already have answers in the code** (see Disagreements for how the jurors read them).

## Disagreements

**D1. Where a persisted selection lives.** Contradiction says the URL: a sprint selection is not reader-relative, the convention reserves localStorage for reader-relative state (`schema.ts:4498`, `mine-filter.ts:4-17`), and the Planning tab already keeps its sprint selection in the URL (`App.tsx:284`, `:1040`). Deliverable and cost say localStorage under `plot-board:agents:*`, reading the same `mine-filter.ts` as precedent for "a filter that hides rows". Estate names both conventions and picks neither. Contradiction alone raises the prior question: the selection is recorded as NOT PERSISTED (`AgentList.tsx:553-565`) and the Released plan `2026-10-01-an-open-board-follows-a-sprint-change` keeps that. The disagreement is whether a sprint selection is a shareable view or a personal convenience; no juror can settle it.

**D2. What the row slug reads.** Cost says `AgentRow.sprint` already holds the slug (`schema.ts:2556-2560`, first Active sprint wins) and needs no payload change. Deliverable says the row needs a list of its sprints from `sprintMembershipLookup`, and claims `r.sprint` is empty on 53 rows. That figure belongs to the pre-2026-08-24 field (the plan's `Sprint:` back-reference); `schema.ts:2537-2553` says `sprint` is now set from the sprint file's member list, so the 53 does not apply to the current field. Estate and contradiction keep the real point both arms touch: with first-wins, a plan in both sprints shows the first slug while the selection is the second. The choice is first-wins (no payload change, one known mismatch) or a list (payload change, no mismatch).

**D3. Where membership is decided.** Contradiction wants the predicate (`slugPassesSprintFilter`, `rowIsSprintExempt`, `sanitizeSelection`) moved into `@plot-pm/domain` or declared as a duplicate with a corpus test, because two implementations of "in the selected sprint" is the split `2026-10-01` fixed. Cost names the move as a three-tab blast radius (the Board tab and Swimlanes share `filters.ts`) and offers keeping `inSprint` as a caller-supplied boolean. Estate and deliverable state the gap without choosing.

**D4. The selection control.** Only contradiction reads "the sprint lines become the control" as reversing `2026-10-19`'s decision that the sprint line reports and does not filter. The other three accept the issue's UI suggestion without checking it against #2080.

**D5. Test shape.** Cost asks for unit tests in place of "one browser test per behaviour" (three new board-server starts against one in the precedent plan) and flags that the label change breaks `[data-chip="This sprint"]` in four browser test files. Contradiction asks to restore the browser test #2137 dropped. These are compatible only if the restored test is the one browser test.

## Shared blind spot

**No juror executed anything.** All four read code and plans; two tried `chip-row.test.ts` and could not run it because the worktree has no `node_modules`. Every finding is a reading, and the 53-row figure in D2 shows a reading can carry a stale number.

**No juror looked at the reporting estate.** The motivation comes from ewz-kus-portal, and no juror checked whether the five plans of `kus-portal-103-markus` are also members of `kus-portal-103`. If they are, first-wins (D2) shows the wrong slug on exactly the rows the issue is about, and that decides D2.

**No juror priced the Planning tab.** `Board.tsx:177` and `Swimlanes.tsx:124` gate a sprint badge on `sprintSel.length === 0` in `.tsx` (estate found it). The plan adds a second row-slug rule on the Delivery tab; whether the two tabs share one domain property was asked by nobody.

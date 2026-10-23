# Juror: estate lens

Position: amend

The defect is real and the domain-first shape is right. The plan describes the estate as if selection, row sprint slugs and the persistence question were new. Most of each already exists, and two of them were decided against on record. The plan must name those decisions and say which it reverses.

## Findings

### F1. Per-sprint selection exists today. The chip throws it away.
`AgentList.tsx:566` holds `sprintFilter` as a `Set<string>` of sprint slugs. `selectedSprints` (`:625-628`) derives it through `sanitizeSelection` (`lib/filters.ts:165`), and `slugPassesSprintFilter(r.plan, selectedSprints, membership)` (`:660-663`, `lib/filters.ts:309`) already filters rows to any SUBSET of Active sprints. Only the control collapses this to all-or-nothing: `toggleThisSprintChip` (`:637`) selects every slug, and the comment at `:567-571` says the per-sprint checkboxes were removed with the chip. Those checkboxes (`data-sprint-toggle`, `onToggle(slug)`) lived in `SprintFilter.tsx` until `f19611d58` (#2137, plan `2026-10-19-one-chip-row-and-a-sprint`). So #2399 is a regression of #2137, not a missing feature. The Motivation and Approach say neither.
Open Point: the operator decides whether the slices restore the existing Set-based selection (a single slug or a subset) or replace it with the single slug the plan proposes. Single-select discards a capability the filter code still carries.

### F2. Row membership is computed in the component, not in `chip-row.ts`.
The plan says `inSprint` "becomes true for a row ... in the selected sprint" as a domain change. Today `inSprint` is built in `AgentList.tsx:697-701` from `rowIsSprintExempt` and `slugPassesSprintFilter`, both board-side (`lib/filters.ts:309`, `:355`), against `allSprintSlugs` (`:694`). The filtered rows use a second call site (`:660-663`) against `selectedSprints`. `chip-row.ts:37` only receives the boolean. Slice 1 as written ("chip-row readings, row membership") cannot change membership without moving `slugPassesSprintFilter`/`rowIsSprintExempt` into `@plot-pm/domain`, or without the component passing `selectedSprints` instead of `allSprintSlugs` at `:700`. Today the chip's `hiddenCount` and the actual filter read different slug lists, and that is safe only because the chip is all-or-nothing. Once one sprint can be selected, the two lists differ.
Open Point: the operator decides whether slice 1 moves the membership predicate into the domain (the layering rule says yes), and names the one reading both the filter and `hiddenCount` derive from.

### F3. Rows already carry a sprint slug, and the two-sprints question is already answered.
`AgentRowSchema.sprint` (`contract/schema.ts:2537-2566`) is set server-side (`fleet.ts:6059`). It holds ONE slug: "where two sprints are Active and both list a plan, the FIRST active sprint wins" (`:2556-2560`), and it names the per-sprint control as "a later slice's concern". So Open Question 2 is answered in the schema: first-wins. The edge case is that a plan listed in both sprints, with the SECOND selected, passes the filter (membership map) but its row slug names the FIRST sprint. The row then states a sprint the reader did not select.
Open Point: the operator decides whether the row slug shows `row.sprint` (first-wins, a payload field that exists) or the selected sprint when the row is in it. The schema's `ONE SLUG` comment changes if a list is needed. The plan's "measure whether this occurs" cannot be answered from this repo (no Active sprint). Name ewz-kus-portal's two sprint files as the measurement.

### F4. A sprint badge with a show/hide rule already exists, decided in a component.
The Planning tab renders `<Badge variant="sprint">{card.sprint}</Badge>` (`PlanCard.tsx:386`), gated by `showSprint = sprintSel.length === 0` in `Board.tsx:177` and `Swimlanes.tsx:124`. Its rule is "show while no sprint is selected", not "while more than one is Active". The plan adds a second rule for the same badge on another tab, in the domain, while the first stays in `.tsx`.
Open Point: the operator decides whether one domain property (`showsSprintSlug`) serves both tabs, and which rule it keeps. Two rules for one badge across tabs is the divergence `Every rendered state is a domain property` exists to prevent.

### F5. Persistence was decided against twice. Open Question 1 has an answer.
`AgentList.tsx:556-565`: "NOT PERSISTED: this is a momentary focus ... Persisting it would restore a filter that no longer matched the reader's task" and "NOT SYNCED TO URL". Plan `2026-10-01-an-open-board-follows-a-sprint-change` (Released v2.23.0), *What this does NOT do*: "It does not persist the Agents tab's selection ... this plan keeps it." The store conventions: the URL for shareable view state (`collapse.ts:24-30`; the Planning tab's sprint multiselect via `readList('sprint')`/`writeList`, `App.tsx:284`, `:1040`, `:1217`), and `localStorage` for personal convenience (`mine-filter.ts:17` `plot-board:agents:mine-only`, `collapse.ts:40`). The plan's Changelog already promises "persists per viewer" before its own OQ1 is answered.
Open Point: the operator decides to reverse the 2026-10-01 non-persistence decision explicitly (and the comment at `:556`), and picks URL (matches the Planning tab's sprint filter, shareable) or `localStorage` (matches `Mine`). A persisted slug also needs the existing prune effect (`:654-659`) and the empty-list guard. Slice 2 must list a test for "persisted slug of a closed sprint".

### F6. Open Question 3: estate totals follow no filter today.
`DeliveryFilters` receives `fleet.estateTotals` unchanged (`AgentList.tsx:962`). `Mine` and `This sprint` do not scope it, although the delivered #2137 Changelog says the totals "count what the active filters leave in view". Each sprint line already carries that sprint's own `counts` (`DeliveryFilters.tsx:124`).
Open Point: the operator decides whether this plan leaves estate totals unscoped (consistent with every other filter today) or fixes the #2137 drift for all chips. Scoping them to the selected sprint only would make the sprint chip the one filter they follow.

### F7. Open Question 4 conflicts with the delivered Changelog.
#2137's Changelog says "The sprint name links to the sprint". The code says it is not a link (`DeliveryFilters.tsx:105-108`). Making the line a click-to-filter control settles that drift in a third direction.
Open Point: the operator confirms that the sprint line becomes a filter control, and that the next release note corrects the shipped "links to the sprint" claim.

### F8. Other consumers of the selection the plan does not name.
These read `selectedSprints`/`sprintFilterOn` and change meaning with one sprint selected: `workersHiddenByFilter` (`AgentList.tsx:~722-731`, the stepper's "N hidden by filter"), `unfilteredSectionedRows` (`:1031`), `unfilteredCount`/`data-sprint-unfiltered` (`:1245-1252`), and the exempt mark from `2026-09-29-a-sprint-view-says-what-it-hid`. The slice test lists name none of them.
Open Point: the operator decides which of these follow the single selection, and slice 2 lists a test for each, or states why one stays all-sprints.

### F9. Siblings do not overlap.
None of the seven sibling plans touches sprints, `AgentList`, `DeliveryFilters` or `chip-row` (their only "sprint" hit is the empty `Sprint:` status field). No ordering constraint.

### F10. The slices ship, with one order risk.
Slice 1 alone ships a domain rule that has no caller until slice 2. Per F2, it cannot change row membership without touching `AgentList.tsx:700`, which belongs to slice 2's package. The Changelog's "persists per viewer" depends on F5's unresolved decision.

## Read / Ran

Read: the subject plan; `packages/domain/src/rules/chip-row.ts` (whole); `packages/board/src/app/components/DeliveryFilters.tsx` (whole); `AgentList.tsx:540-760` and grep hits `:962`, `:1031`, `:1245`; `lib/filters.ts` (definitions at `:24`, `:165`, `:187`, `:309`, `:355`); `lib/agent-rows/mine-filter.ts` and `collapse.ts` (storage keys and the convention comment); `contract/schema.ts:2535-2566` and `:4480-4520`; `App.tsx` sprint-selection grep hits; `PlanCard.tsx:386`, `Board.tsx:177` and `Swimlanes.tsx:124` grep hits; `SprintFilter.tsx` at `f19611d58^` (grep); delivered plans one-chip-row (to `## Slices`), sprint-filter-says-what-it-filters, a-sprint-view-says-what-it-hid, an-open-board-follows-a-sprint-change and a-sprint-cannot-be-read-as (heads); `DESIGN-sprint.md` (grep, `:210-222`, `:350-360`); the sibling Approved plan and six sibling Drafts via `git show origin/idea/<b>` (grep for sprint/AgentList/chip-row).

Ran: grep/sed/git log/git show only. No tests, no builds, no board or fleet controls.

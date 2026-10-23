Position: amend

Lens: CONTRADICTION. The plan's goal does not collide with any sibling plan. It does contradict four decisions this repo has already recorded, and it does not name any of them. Each finding below is an Open Point for the operator.

## Findings

### C1. Persistence reverses a recorded decision, and the plan does not say so
- `packages/board/src/app/components/AgentList.tsx:553-565` records the decision: the sprint selection is "NOT PERSISTED: this is a momentary focus … Persisting it would restore a filter that no longer matched the reader's task" and "NOT SYNCED TO URL".
- The delivered plan `docs/plans/2026-10-01-an-open-board-follows-a-sprint-change.md` (Released v2.23.0), *What this does NOT do*: "It does not persist the Agents tab's selection. The comment at `AgentList.tsx:513-517` records that decision, and this plan keeps it." The same plan adds: "A new active sprint is not selected automatically. The reader selected a sprint, not 'the current sprint'."
- The subject plan's design bullet *Persistence per viewer* and its Changelog line "the choice persists per viewer" overturn both statements. The plan lists persistence as an Open Question about *where* to store the selection. It never asks *whether* to store it.
- **Open Point:** does the operator reverse the 2026-10-01 non-persistence decision? If yes, the plan must cite it, give the reason, and update the `AgentList.tsx:553-565` comment. If no, delete the persistence bullet and the Changelog clause.

### C2. Open Question 1 already has an answer, and the answer points away from "per viewer"
- Convention: "view state in the URL, convenience in localStorage" (`packages/board/src/contract/schema.ts:4498-4501`; `lib/agent-rows/collapse.ts:21-37`; `lib/agent-rows/mine-filter.ts:4-17`). localStorage holds *reader-relative* state. The reason given there: "a link carrying `?mine=1` would hide rows belonging to whoever opened it".
- A sprint selection is not reader-relative. "Look at Markus's sprint" is worth sharing. The Planning tab already keeps its sprint selection in the URL (`App.tsx:284` `readList('sprint')`, `App.tsx:1040` `writeList('sprint', …)`), and `sanitizeSelection` cleans that selection.
- So the convention puts this state in the URL, not in per-viewer storage. The plan's phrase "where the board already stores per-viewer filter state" already assumes localStorage.
- **Open Point:** if the selection persists (C1), does it go in the URL, as the Planning tab's sprint selection does, or in localStorage, as `Mine` does? The convention says URL. A localStorage choice must say why it departs from the convention.

### C3. The sprint line becomes a filter again, and #2080 removed exactly that
- The delivered plan `2026-10-19-one-chip-row-and-a-sprint.md` (Released v2.28.0) names the defect it fixed: "The sprint card mixes the filter with a status report". Its Design says: "The sprint line reports the sprint only".
- The subject plan's bullet *Selection UI*, "The sprint lines in the header become the control", puts the filter back into the report line.
- That same delivered plan's Changelog also says "The sprint name links to the sprint". The code did not build that link and left the question open (`DeliveryFilters.tsx:105-108`). A click that filters closes that question with a different meaning, and the subject plan's Open Question 4 only asks for the operator's assent.
- **Open Point:** does the selection live in the chip row (for example a split chip, or one chip per Active sprint while more than one is Active), so that the sprint line stays a report as #2080 decided? Or does the operator reverse #2080 for the sprint line, which also closes the "link to the sprint" question?

### C4. This is a regression, not a new feature
- Per-sprint selection shipped with `the-sprint-filter-says-what-it-filters` (2.9.0) as one checkbox per Active sprint. `2026-10-01` keeps it: "Two selected sprints, one closed, keep the other."
- #2137 (`f19611d58`) removed it as a side effect. The commit body: "dropping two tests whose assertions have no surviving equivalent (a subset-of-active-sprints selection …)". The plan `2026-10-19-one-chip-row-and-a-sprint.md` never decided that selection would become all-or-nothing. Only the code comment says so (`AgentList.tsx:566-570`, :636-641).
- The machinery is still in place: `sprintFilter: Set<string>`, `selectedSprints` via `sanitizeSelection`, and `slugPassesSprintFilter(plan, selectedSprints, membership)` (`lib/filters.ts:309-337`). These already filter by a subset and already drop a stale slug.
- **Open Point:** should `Type:` be `bug`, citing #2137 as the cause? Should the browser test that #2137 dropped be restored as the UI slice's test? The plan's claim that the selection rule is new work is overstated, because `sanitizeSelection` already answers "a slug that names no Active sprint reads as none".

### C5. "All decided in the domain" moves only the count, not the filter, and that recreates the #1145 split
- `chipRow` does not compute membership. It counts `!row.inSprint` (`chip-row.ts:85`). The board computes `inSprint` (`AgentList.tsx:697-701`, against `allSprintSlugs`) and computes the filter itself (`AgentList.tsx:660-663`, against `selectedSprints`).
- The bullet *Row membership* puts `inSprint` in the domain while `filteredRows`, `workersHiddenByFilter` (:722-730), the exempt mark and `unfilteredSectionedRows` all still read `slugPassesSprintFilter` in the board.
- That leaves two implementations of "is this row in the selected sprint". `2026-10-01` fixed exactly this shape: "the control and the filter answer from two different sprint sets".
- **Open Point:** does slice 1 move `slugPassesSprintFilter`, `rowIsSprintExempt` and `sanitizeSelection` into `@plot-pm/domain`, so that one rule drives both the chip count and the filter? Or does it declare the duplicate and add a corpus test? The plan must name every consumer that `2026-10-01` lists (:569, :570, :579, :624, :984, :1178, :2225).

### C6. Open Question 2 already has an answer, and it conflicts with the row-slug bullet
- `AgentRow.sprint` is ONE slug, set on the server: "where two sprints are Active and both list a plan, the FIRST active sprint wins" (`schema.ts:2556-2560`; `fleet.ts:6059`).
- The filter instead asks the full membership map (`filters.ts:325-333`). A plan listed in both sprints passes a filter on the *second* sprint while its row reads the *first* sprint's slug, so the view contradicts itself.
- Membership comes from the sprint file and never from the plan's `Sprint:` field (`schema.ts:2543-2548`, decided in `2026-08-24`). The row slug must not fall back to that field.
- **Open Point:** a row listed in two Active sprints shows (a) every slug that lists it, which needs a list on the payload, or (b) the selected sprint's slug when one is selected, and otherwise the first-wins slug. Which one?

### C7. The plan settles an open story question without citing it
- `docs/stories/plot-works-in-five-phases/STORY-plot-works-in-five-phases.md:64` leaves item 12 open: "⏸️ More than one Active sprint … The plan default for the *Active sprint* toggle: the union of every Active sprint."
- The subject plan decides item 12. It keeps the union as the default and adds a selection.
- **Open Point:** link the plan to that story item, and record the decision in the story's Decisions table when the plan is approved.

### Consistent with the repo (no contradiction)
- More than one Active sprint is allowed: `FleetSprintSchema` (`schema.ts:4061-4063`, "Two teams may share one train"); `skills/plot-sprint/SKILL.md:66` ("multiple → list and ask").
- A stale selected slug reading as none matches `sanitizeSelection` and `2026-10-01`.
- No sibling conflicts: none of the seven siblings touches `chip-row.ts`, `DeliveryFilters.tsx`, `AgentList.tsx` or `lib/filters.ts`. `recording-a-slice-pr-number-writes` touches `fleet.ts` only. `origin/idea/plot-approve-reports-no-pr-found` does not exist on the remote, so that sibling was not read.

## Read / Ran

READ: the subject plan; `packages/domain/src/rules/chip-row.ts`; `packages/board/src/app/components/DeliveryFilters.tsx`; `AgentList.tsx:540-760`; `lib/filters.ts:309-356`; `lib/agent-rows/collapse.ts:15-40`; `lib/agent-rows/mine-filter.ts:1-30`; `contract/schema.ts:2530-2565`, `:4055-4075`, `:4480-4515`; `App.tsx:284`, `:1040`; the delivered plans `2026-10-19-one-chip-row-and-a-sprint`, `2026-08-24-the-sprint-filter-says-what-it-filters`, `2026-09-29-a-sprint-view-says-what-it-hid` and `2026-10-01-an-open-board-follows-a-sprint-change` (Design sections), and `2026-10-21-a-sprint-cannot-be-read-as`; `STORY-plot-works-in-five-phases.md:55-75`; `skills/plot-sprint/SKILL.md` (grep); sibling plans (grep for sprint, chip and the touched files); the commit body of `f19611d58` (#2137).

RAN: `grep` and `git log -S"all-or-nothing"` over the worktree; `git show origin/idea/<b>:…` for the six Draft siblings. I ran no tests, because every finding is a reading of a recorded decision and needs no execution.

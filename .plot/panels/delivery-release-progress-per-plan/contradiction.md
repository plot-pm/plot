# Contradiction lens verdict

Position: amend

Read: the subject plan in full; plan 1 (delivery-tab-header-and-my-sprint) slices, open questions and Owner text; plans 2, 3, 4, 6 slice lines and open questions; the design spec's Release Delivery and Calls Made After Review sections (lines 72-90, 166-206). Ran grep for `waits:`, "blocked", "five". Did not open packages/board or packages/domain beyond confirming `rules/sprint-record.ts` exists, and did not read the 2026-11-08 design or the story.

Cross-references that hold: plan 1 declares `feature/delivery-section-header` (line 87) and `feature/delivery-my-sprint-scope` (line 99) under those exact names. Plan 1 also lays the section-header pattern and the scope rule and Owner field this plan cites. The five states and the "blocked = You > Blocks delivery" definition match design line 185 and plan 1 line 42. Plan 3 line 42 agrees that a not-started slice shows only in this plan's opened list. Slice/Wave terminology is clean.

Findings

1. (misleads) Settled Questions line 55 says every slice waits on `feature/delivery-section-header`, but the sprint-scope slice (line 78) carries only `waits: feature/delivery-my-sprint-scope`. Plan 1's `my-sprint-scope` slice (plan 1 line 99) has no `waits:` marker at all (plan 1 open question line 67 admits this), so the header dependency is not transitive. Add the header wait to the slice or drop "every".

2. (misleads) The person-cards slice (line 74) reads sprint owners ("the owners of the sprints that name that release", line 41) but waits only on the section header. The Owner field is built by plan 1's `feature/sprint-owner-field` (plan 1 line 91). Prose line 34 names the Owner dependency only for the sprint-scope slice. Add `waits: feature/sprint-owner-field` to person-cards. The plan-row "Owner" column (line 38) also reads this field or a plan owner that does not exist; name which.

3. (misleads) The scope rule line 43 claims "a slice listed here always has its row in Work items or You", while line 40 and plan 3 line 42 put a not-started slice in the opened list with no row elsewhere. The plan inherits this from design line 186 but restates it unqualified. Say "a slice that has started".

4. (misleads) Done When item 3 requires every slice under exactly one of Done / In flight / To do, but the five strip states do not map one-to-one. A blocked slice (a You row) and an at-gate slice are not placed in any group by line 39. Name the mapping, e.g. at gate, building and blocked all go under In flight.

5. (misleads) "Blocked" depends on plan 2's unresolved question of which of 12 `YouReason` values fall under Blocks delivery (plan 2 line 90). The strip's blocked count and the header's "<n> blocked" have no stable source until that lands, and plan 4 uses "blocked" for agents, a different meaning. The plan has no `waits:` on plan 2's `feature/delivery-you-groups`. Declare it, or state the interim source (today's You groups).

6. (cosmetic) Plan 1's open question about reader-owns-several-sprints and no-Owner-yet (plan 1 line 68) determines whether the "group by sprint" behaviour here ever appears. The plan does not record that it inherits that open question.

Approvable as written: no. The slice names are correct and nothing is fundamentally wrong, but the waits markers contradict the plan's own stated dependencies (1, 2, 5) and the scope sentence contradicts line 40 (3). These are small edits.

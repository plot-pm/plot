# Deliverable lens, round 2

Position: amend

Read: the subject plan in full; plans 1 (`delivery-tab-header-and-my-sprint.md`) and 3 (`delivery-work-items-show-gates.md`) by their slice markers, Design and open questions; the design's Release Delivery section (spec lines 72-86); `delivery-view.ts:186-192, 255-280, 423-439`; `collapse.ts:20`; `row-identity.ts:77`; `components/AgentList.tsx:1219, 1376-1401`; `rules/deliverable.ts:175, 302-310`; a grep for `mergedAt` under `packages/board/src`; the round-1 deliverable verdict. Not run: no tests, no board. Not read: plans 2, 4, 6, the 2026-11-08 design, the story.

## Round-1 fixes that hold

- The three slice markers now carry the waits the Settled and Open Questions claim (`plan:112, 116, 120`). `feature/sprint-owner-field` (plan 1:113), `feature/delivery-slice-states` (plan 1:121), `feature/delivery-work-items-gates` (plan 3:82) and `feature/delivery-my-sprint-scope` (plan 1:137) all exist under those names.
- Changelog (7 bullets) and Done When (10 lines) now cover the header counts, per-release blocks and person cards. Each slice builds something named: plan rows, person cards, Sprint delivery scope.
- Line citations check: `releaseLines`/`deliveredBlocks` at `delivery-view.ts:186-192` and `423-439`, `COLLAPSED_BY_DEFAULT` at `collapse.ts:20`, `isUnbegun` at `row-identity.ts:77`, `dispatch` at `AgentList.tsx:1219`. The file is `components/AgentList.tsx`, not under `app/`; a name-only difference.

## Findings

1. (cannot be built as written) Design line 44 and Done When 3 say "1 / 5 delivered" "reads `sliceProgress`'s counts". `sliceProgress` (`rules/deliverable.ts:302-310`) returns the string `"<merged> of <total> slices merged"` or `undefined`. The counts come from `slicesOf` (`deliverable.ts:175`), a non-exported `const`. A builder cannot read counts from the function the plan names. The plan must say that the slice exports `slicesOf` (or a counts function) and that the strip shows nothing for a partial pulse (`undefined`), or must name plan 1's slice-state counts as the one source. The plan also reads the header counts from plan 1's counts (line 42), so two sources of "delivered" exist; Done When 3 asserts they match but no slice owns that.

2. (slice list and Done When disagree) The mapping table (lines 48-53) covers delivered, at a gate, being built, blocked and not started. Plan 3 (line 44) adds a Queued group: a slice with a branch or claim and no live agent. That slice is not "not started" (it has a branch) and is neither at a gate nor being built. Plan 1 leaves this open and unresolved (`delivery-tab-header-and-my-sprint.md:92`, "the five counts add up ... can fail"). Done When 3 ("five states add up to the plan's slice count") and Done When 5 ("exactly one of Done, In flight, To do") fail for a Queued slice, and the plan-rows slice does not wait on that question. The plan should name the mapping for Queued (In flight, linking to its Queued row is the natural one) and state that it holds only once plan 1's question resolves.

3. (misleads) Done When 6: a Done line shows its PR and `mergedAt` "from the PR index ... Neither adds a host call". `mergedAt` is on no board payload today: grep under `packages/board/src` finds it only in server-side `deliver.ts`/`board.ts`. The plan says the slice "adds both fields to the payload" but states no outcome for a merged slice whose index row is missing, whose store is wrong-version or `complete: false`, or whose merge predates the store. `CLAUDE.md` (A Decision Reads The Index) says a missing row means ask the host, and the plan forbids the host call. The Done line for that slice has no defined text, and Done When 6 has no case for it. Name the fallback ("merged", no date).

4. (overlap with plan 1) Plan 1's `feature/delivery-my-sprint-scope` (plan 1:137) applies the scope "to the status card, Release delivery, You and Work items", and does not wait on `feature/delivery-release-plan-rows`. This plan's plan-rows slice replaces `deliveredBlocks` and `releaseLines`. If my-sprint-scope lands first, its scope on Release delivery is applied to a structure the plan-rows slice deletes; if plan-rows lands first, my-sprint-scope has a new section to scope. Neither order is declared, and the sprint-scope slice here (line 120) also claims the section's title and grouping. State which slice owns narrowing the plan list by scope (plan 1's rule, applied here) and add the plan-rows slice's own expectation to Done When 10 that the section reads the scope rule rather than recomputing it. Plan 1's open question (`:97`) already notes both plans claim to scope the section.

5. (misleads) Person cards: Changelog says "one card per team member", Done When 9 says "one card per sprint owner shows that sprint's progress". An owner of two sprints, and a sprint with no Owner (plan 1:40: counts toward the release, belongs to nobody), have no stated card. The release progress bar counts the Owner-less sprint's slices; the cards do not show them, so cards and release total disagree. Say whether an owner with several sprints gets one card with a bar per sprint (plan 1's sprint card does, per `plan 1:133`) and whether an Owner-less sprint shows a card.

6. (minor) Removing `release-delivery` from `COLLAPSED_BY_DEFAULT` changes the default only. `readCollapsed` keeps a stored key (`collapse.ts:60` fallback is used only when nothing is stored), so a reader who already collapsed the section keeps it collapsed. Done When 1 ("a section that is itself open") holds for a new reader only. Say so or reset the stored key.

7. (minor) The plan-rows slice holds eight deliverables in one marker (header, per-release blocks, plan rows, strip, Owner, opened list, Done fields on the payload, Work items removal plus Start move). Round 1 asked to split; the resolution made it larger. It does ship one coherent section, but the Work items removal and the Start move are a separate behaviour change to a different section; a builder can ship them as a second PR only by splitting the slice, and the wave gate sees one branch. Not blocking.

## What a builder would hit that the plan does not say

- "A slice whose earlier slices have landed" (Start eligibility, line 57) is today computed per wave group (`head.mode === 'start'`, `delivery-view.ts:268`: all rows not-started), not per slice; the per-slice rule is new and needs its own domain fact and test; the plan lists it among "Start eligibility" but gives no rule for a slice that waits on a slice in another plan.
- "What it waits for" (`after Reads`) is read from the `<!-- waits: -->` marker or slice order (plan 3 does this for Queued); the To do line here must reuse that fact, not build a second one.

## Approval

The three slices each ship something and the Changelog and Done When now match them. The gaps are in what the plan names as its source (finding 1), an unmapped state (2), a missing fallback (3), an undeclared order against plan 1's scope slice (4) and an ambiguous card unit (5). All are fixable in the plan text; none needs a new slice.

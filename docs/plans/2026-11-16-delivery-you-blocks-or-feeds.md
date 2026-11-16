# Delivery tab: You shows what blocks delivery and what feeds the fleet

> The You section groups what waits on the reader as Blocks delivery, Input to the fleet and Unblock, shows one row per plan with its slice count and open questions, holds loose ends with Release and Delete, and counts tickets instead of listing them.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:**
- **Story:** delivery-tab-reads-at-a-glance
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The **You** section shows three groups: **Blocks delivery** (red), **Input to the fleet** (blue) and **Unblock** (grey, "clean up"). The group says why a row is the reader's, so no reason sentence repeats down a column.
- A plan shows as one row with a chip for its slice count, a chip for its open-question count, and its first open question with a "+n more" link.
- A PR sits under **Blocks delivery** when a person's comment is unanswered, when its HIGH finding has spent the `Correction budget`, or when the repository does not declare `Auto-review: true`.
- **Unblock** holds loose branches and closed PRs whose branch still exists, each with **Release** and **Delete**.
- Tickets leave the rows of **You**; the header counts them and links to the **Tickets** section.

Board impact: changes the You section's grouping rule and rows in `packages/board`; no change to the plan format, the template, the helper scripts or the `docs/plans` layout. Rebuild the board artifact (`pnpm build:board`) with each slice that changes the board.

## Motivation

Plan 2 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: "a ticket is assigned to you and no plan names it" repeats about 30 times, "a draft plan needs your input" repeats under every slice of a draft plan, and 30 ticket rows push the two draft plans that need the developer out of view.

The design is canonical. This plan implements its *You* section, the first and third points of *Changes to the 2026-11-08 Design* (You's groups, Tickets), and the *Calls Made After Review* points listed below. It does not restate them.

## Design

### Approach

Depends on plan 1, `delivery-tab-header-and-my-sprint`, for the section-header pattern; every slice waits on its `feature/delivery-section-header` slice.

- **Header.** "<n> block delivery · <n> inputs the fleet waits for · <n> tickets to triage", each count linking to its group, then the phase strip `Discovery n ─▶ Design n ─▶ Handed to fleet n` from the 2026-11-08 design.
- **Three groups in the placement rule** (`packages/domain/src/rules/delivery-placement.ts`), in this order: **Blocks delivery**, **Input to the fleet**, **Unblock**. *Review a result* folds into Blocks delivery; a slice whose agent died or whose budget is spent moves to Blocks delivery; Unblock holds loose ends only (*Changes to the 2026-11-08 Design*).
- **The PR rule** (*Calls Made After Review*, "A PR blocks delivery; no PR is an input"): a PR sits under Blocks delivery when it has an unanswered comment from a person, when its HIGH finding has spent the `Correction budget`, or when the repository does not declare `Auto-review: true`. Otherwise a slice PR is a gate under Work items. "A PR that needs a decision" leaves the Input group.
- **Markers.** Blocks delivery is red, Input to the fleet blue, Unblock grey and labelled "clean up" (*Calls Made After Review*, "Unblock rows carry a third marker"). The to-do list in the tab header (plan 1) reads the same markers from this rule.
- **Columns:** Kind · Item · Status · Do · Age. **Status** holds the item's state ("Draft · not interrogated", "loose · no plan, nobody works on it"); **Do** holds the verb with `›`, and Unblock rows hold "Release · Delete". No BY column: every row is the reader's.
- **One row per plan.** A plan in Draft or Design is one row with a slice-count chip, an open-question chip, and the first open question with a "+n more" link. Its slices do not show as rows here.
- **Unblock.** A loose branch and a closed PR whose branch still exists, each with **Release** (the `release-claim` controller) and **Delete** (the `loose-delete` controller, `LooseDeleteButton.tsx`). A closed PR or a branch no plan names moves here from Queued (*Work Items*).
- **Tickets** are a count in the header and in the to-do line, and rows in the Tickets section (plan 6), not rows here.
- **You always means the reader** (*Calls Made After Review*): You ignores the Mine filter's three modes. The **My sprint** scope from plan 1 narrows it to what waits on the reader in their sprint.
- **Domain first.** Every group, marker, chip count and Status value is a domain property with a unit test.

### Done When

- No reason sentence repeats down the Status column; the group carries the reason.
- A draft plan with five slices shows as one row with "5 slices" and its open-question count.
- Each of the three PR conditions places a PR under Blocks delivery, and a PR with none of them places it under Work items, each asserted in a unit test.
- A loose branch shows under Unblock with Release and Delete, both calling their controllers.
- No ticket row shows under You, and the header's ticket count links to the Tickets section.

### Settled Questions

- Every slice waits on plan 1's `feature/delivery-section-header`. Writer's call, from the design: plan 1 lays the section-header pattern every later plan uses.

### Open Questions

- [ ] Until plan 6 ships the Tickets section, where does the header's ticket count link?

### Left to the Builder

- The names of the new domain facts and their types, within the domain's terminology.
- Which existing browser tests move to unit tests.

## Slices

### Groups and markers

- `feature/delivery-you-groups` <!-- waits: feature/delivery-section-header --> — the placement rule's three You groups with their markers, the PR rule, the You header with its phase strip, and tickets out of the rows <!-- builds: You groups Blocks delivery, Input to the fleet and Unblock -->

### Plan rows

- `feature/delivery-you-plan-rows` <!-- waits: feature/delivery-section-header --> — one row per plan with slice-count and open-question chips and the first open question, the Kind · Item · Status · Do · Age columns, and Unblock rows with Release and Delete <!-- builds: a one-row plan form for You -->

## Notes

- Created by `/plot-idea` in one batch with plans 1 and 3 to 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "Blocks delivery" and "Input to the fleet" found no artifact of that name in the estate; the existing groups live in `delivery-placement.ts`, which this plan changes.

## Open Points

- [ ] [Domain] Where does the PR rule's "unanswered comment from a person" reading come from? `humanCommentOpen` exists, but `PrReading` carries no conversation and the design forbids new host reads. Options: a PR-index field with a writer, or drop the condition and record the gap.
- [ ] [Domain] Does a closed PR on a branch a plan's slice names get a Delete? `loose-delete` refuses it as `named`, and `a-deferred-slice-keeps-its-branch` relies on that refusal.
- [ ] [Technical] Do the two slices run in parallel? Both edit `delivery-placement.ts`, `delivery-row-form.ts`, `delivery-view.ts` and `AgentList.tsx`, and slice 2's Unblock rows need slice 1's groups. Options: slice 2 waits on `feature/delivery-you-groups`, or all placement changes move into slice 1.
- [ ] [Domain] Which group holds each of the 12 `YouReason` values? `release-approval`, `blocked-marker` and `merge-conflict` are not named, and a folded Review a result would show the release a second time.
- [ ] [Domain] Does the Auto-review arm keep today's `ci === 'passed'` guard, and what happens to `gateUnpassable` and a failed CI with the budget spent (`fleet-stuck`)?
- [ ] [Domain] Does "You ignores Mine" mean `ownership === 'mine'` in every mode? No slice and no Done When line owns the change at `delivery-placement.ts:337`.
- [ ] [UX] Between this plan and plan 6, the reader's unplanned tickets show on no row. Does slice 1 wait on the Tickets section, or do ticket rows stay in You until it ships?
- [ ] [Technical] What is the source of the open-question chip and first open question? No parser reads a plan's `### Open Questions`. The phase strip's "Handed to fleet" count is also unbuilt.
- [ ] [Scope] Changelog line 4 and Done When line 4 describe loose-branch Release and Delete, which ship today (`AgentList.tsx:1165-1172`). The new part is the closed PR. Done When has no line for markers, columns, header counts or the Mine change.
- [ ] [Technical] "Rebuild the board artifact with each slice" conflicts with `check-no-bundle-diff.sh`; the story link at lines 11 and 27 resolves to no file.

<!--
CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "engine": "panel",
  "questionHistory": [],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": false
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

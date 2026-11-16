# Delivery tab: Release delivery shows progress per plan

> Release delivery shows one collapsed row per plan with a slice strip, opens to a Done / In flight / To do list of its slices, shows a progress card per person, and switches to Sprint delivery with the My sprint toggle.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:**
- **Story:** delivery-tab-reads-at-a-glance
- **Review:** pr
- **Impl:** own branches

## Changelog

- **Release delivery** shows one row per plan (Plan · Phase · Slices · Owner), collapsed by default, with a slice strip of one block per slice coloured by state and "1 / 5 delivered".
- An opened plan row lists its slices under **Done**, **In flight** and **To do**; an in-flight slice links to its row in Work items or You, and a slice to do names what it waits for.
- In release scope, one card per team member shows their sprint and its slice progress.
- With **My sprint** on, the section reads **Sprint delivery · <name>** and groups its plans by sprint where the reader owns several.

Board impact: changes the Release delivery section in `packages/board`; no change to the plan format, the template, the helper scripts or the `docs/plans` layout. Rebuild the board artifact (`pnpm build:board`) with each slice that changes the board.

## Motivation

Plan 5 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: Release delivery lists every merged slice of every plan in Testing, about 40 rows where nothing needs anyone.

The design is canonical. This plan implements its *Release Delivery* section, the sprint-scope row of *The "My sprint" Toggle*, and the *Calls Made After Review* points listed below. It does not restate them.

## Design

### Approach

Depends on plan 1, `delivery-tab-header-and-my-sprint`, for the section-header pattern; every slice waits on its `feature/delivery-section-header` slice. The sprint-scope slice also uses plan 1's scope rule and sprint Owner field.

- **The one place a plan's full slice list lives.** Release delivery stays outside the placement rule, as the 2026-11-08 design settled.
- **Header.** "<delivered> of <total> slices delivered · <n> at gates · <n> blocked · <n> plans in Testing · <n> in Development".
- **One row per plan:** Plan · Phase · Slices · Owner. **Slices** is a slice strip, one block per slice, in the five states the progress bar uses: delivered, at a gate, being built, blocked, not started. **Blocked** means the slice sits under You › Blocks delivery (*Calls Made After Review*, "The progress bar has five segments").
- **Collapsed by default** (▸), one of the design's three collapsibles. Opened (▾), it lists every slice in order under **Done** (✓ merged, the slice, its PR, "merged 2 days ago"), **In flight** (⟳ at CI, ● building; the slice links to its row in Work items, or in You where it needs a person, and is not repeated here) and **To do** (○ waits, and what it waits for, "after Reads").
- **A slice that has not started** (no branch, no agent) shows only in its plan's opened list.
- **Progress per person** (release scope only): one small card per team member with their sprint and its slice progress bar. The release's people are the owners of the sprints that name that release (*Calls Made After Review*, "A sprint has an owner").
- **Releases.** Where the active sprints name different `Release:` values, the section shows one block per release; where no sprint names a release, it lists every plan approved for delivery (*Calls Made After Review*, "One status card per target release").
- **Sprint scope.** With **My sprint** on, the section reads **Sprint delivery · <name>**; where the reader owns several Active sprints, it groups its plans by sprint. The scope rule is plan 1's, so a slice listed here always has its row in Work items or You (*Calls Made After Review*, "One scope rule for every section"). Mine narrows this section too.
- **Domain first.** Every strip segment, slice heading, waits-for value, person card and header count is a domain property with a unit test.

### Done When

- A release with 40 merged slices across 8 plans shows 8 collapsed rows, not 40.
- The slice strip's five states add up to the plan's slice count, asserted in a unit test.
- An opened plan lists every slice under exactly one of Done, In flight and To do, and an in-flight slice links to its row elsewhere instead of repeating it.
- With **My sprint** on, the section's title and plans follow the reader's sprint scope.

### Settled Questions

- Every slice waits on plan 1's `feature/delivery-section-header`; the sprint-scope slice also waits on plan 1's `feature/delivery-my-sprint-scope`. Writer's call, from the design's plan order.

### Open Questions

- [ ] In the opened list, which date does a Done slice show where the host reports no `mergedAt` for it (a slice completed by a named commit)?

### Left to the Builder

- How the per-person cards wrap on narrow screens.
- The names of the new domain facts and their types, within the domain's terminology (Slice, not Wave).

## Slices

### Plan rows

- `feature/delivery-release-plan-rows` <!-- waits: feature/delivery-section-header --> — the Release delivery header, one collapsed row per plan with its slice strip, and the opened Done / In flight / To do list <!-- builds: a slice strip and a plan's grouped slice list -->

### Person cards

- `feature/delivery-release-person-cards` <!-- waits: feature/delivery-section-header --> — one progress card per team member in release scope, and one block per target release <!-- builds: per-person sprint progress cards -->

### Sprint scope

- `feature/delivery-sprint-delivery-scope` <!-- waits: feature/delivery-my-sprint-scope --> — Sprint delivery under the **My sprint** toggle, with plans grouped by sprint where the reader owns several <!-- builds: Sprint delivery scope for the delivery section -->

## Notes

- Created by `/plot-idea` in one batch with plans 1 to 4 and 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "slice strip" and "per-person progress" found no artifact of that name in the estate.

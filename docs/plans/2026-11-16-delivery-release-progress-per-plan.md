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
- **Rounds:** 1

## Changelog

- **Release delivery** shows one row per plan (Plan · Phase · Slices · Owner), collapsed by default, with a slice strip of one block per slice coloured by state and "1 / 5 delivered".
- An opened plan row lists its slices under **Done**, **In flight** and **To do**; an in-flight slice links to its row in Work items or You, and a slice to do names what it waits for, with **Start** where it can start.
- The section header counts delivered and total slices, slices at gates and blocked, and plans in Testing and in Development.
- Where the active sprints name several releases, the section shows one block per release; where none names one, it lists every plan approved for delivery.
- In release scope, one card per team member shows their sprint and its slice progress.
- With **My sprint** on, the section reads **Sprint delivery · <name>** and groups its plans by sprint where the reader owns several.
- A slice that has not started (no branch, no agent) leaves Work items and shows only in its plan's opened list.

Board impact: changes the Release delivery section in `packages/domain` and `packages/board`, and removes not-started slices from Work items; no change to the plan format, the template, the helper scripts or the `docs/plans` layout. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one, and `main` builds the bundle after the merge.

## Motivation

Plan 5 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: Release delivery lists every merged slice of every plan in Testing, about 40 rows where nothing needs anyone.

The design is canonical. This plan implements its *Release Delivery* section, the sprint-scope row of *The "My sprint" Toggle*, and the *Calls Made After Review* points listed below. It does not restate them.

## Design

### Approach

Depends on plan 1, `delivery-tab-header-and-my-sprint`, for the section-header pattern, the five-state slice classification (`feature/delivery-slice-states`), the sprint Owner field and the scope rule; and on plan 3's `feature/delivery-work-items-gates`, whose rows the in-flight links target. Plan 2's Blocks delivery groups reach this plan through plan 1's slice-states slice, which waits on them.

- **The one place a plan's full slice list lives.** Release delivery stays outside the placement rule, as the 2026-11-08 design settled.
- **What exists.** A Release delivery section exists: `deliveredBlocks` and `releaseLines` (`agent-rows/delivery-view.ts:186-192, 423-439`), `AgentList.tsx:1378-1400`, and `release-delivery` in `COLLAPSED_BY_DEFAULT` (`agent-rows/collapse.ts:20`). The plan-rows slice replaces `deliveredBlocks` and `releaseLines` with the plan rows, and removes `release-delivery` from `COLLAPSED_BY_DEFAULT`, because the design keeps sections open and collapses only the plan row. The `delivery-view` tests that pin the old shape change with it.
- **Header.** "<delivered> of <total> slices delivered · <n> at gates · <n> blocked · <n> plans in Testing · <n> in Development", read from plan 1's slice-state counts and the plans' phases.
- **One row per plan:** Plan · Phase · Slices · Owner.
  - **Slices** is a slice strip: one block per slice in the five states of plan 1's classification (delivered, at a gate, being built, blocked, not started), which this plan reads and does not rebuild. **Blocked** means the slice sits under You › Blocks delivery (*Calls Made After Review*, "The progress bar has five segments"). "1 / 5 delivered" reads `sliceProgress`'s counts (`rules/deliverable.ts`): a deferred-only slice counts in neither number.
  - **Owner** is the Owner of the sprint that names the plan, from plan 1's sprint Owner field. A plan that no sprint names, or whose sprint has no Owner, shows "—". A plan file carries no owner of its own, and the design's people are sprint owners (*Calls Made After Review*, "A sprint has an owner"). Writer's call.
- **Collapsed by default** (▸), one of the design's three collapsibles. Opened (▾), it lists every slice in order under one of three headings, mapped from the five states:

  | Slice state | Heading | Line |
  |---|---|---|
  | delivered | **Done** | ✓ merged, the slice, its PR, "merged 2 days ago" |
  | at a gate, being built | **In flight** | ⟳ at CI, ● building; the slice links to its row in Work items |
  | blocked | **In flight** | the slice links to its row in You › Blocks delivery |
  | not started | **To do** | ○ waits, and what it waits for ("after Reads"); **Start** where the slice can start |

  An in-flight slice is not repeated here; its row lives in Work items or You.
- **The Done date and PR.** A Done line takes its PR number and its `mergedAt` from the PR index, whose MERGED rows are terminal (*A Decision Reads The Index*); a slice completed by a named commit (`→ commit abc1234`) shows that commit's date from local git. Neither adds a host call. The plan-rows slice adds both fields to the payload.
- **Not started.** A slice that has not started (no branch, no agent) shows only in its plan's opened list, under To do. The plan-rows slice removes those rows from Work items through `isUnbegun` (`row-identity.ts:77`), and moves today's **Start** (`dispatch`) control (`AgentList.tsx:1219`) to the To do line of a slice whose earlier slices have landed. Start is never off the tab.
- **The scope rule and To do.** *Calls Made After Review* says a slice listed here always has its row in Work items or You, and the *Release Delivery* section says a slice that has not started shows only here. Both hold when the guarantee covers the slices in flight: a Done slice and a To do slice have no row elsewhere, and every In flight slice has exactly one.
- **Releases.** Where the active sprints name different `Release:` values, the section shows one block per release; where no sprint names a release, it lists every plan approved for delivery (*Calls Made After Review*, "One status card per target release").
- **Progress per person** (release scope only): one small card per team member with their sprint and its slice progress bar, from plan 1's per-sprint slice-state counts. The release's people are the owners of the sprints that name that release.
- **Sprint scope.** With **My sprint** on, the section reads **Sprint delivery · <name>**; where the reader owns several Active sprints, it groups its plans by sprint. The scope rule is plan 1's. Mine narrows this section too.
- **Payload.** About 40 slices across 8 plans add a state, a PR number and a date per slice: a few kilobytes on the fleet payload.
- **Domain first.** Every strip segment, heading, waits-for value, Start eligibility, person card and header count is a domain property with a unit test.

### Done When

- A release with 40 merged slices across 8 plans shows 8 collapsed rows, not 40, in a section that is itself open.
- The header shows the delivered and total slice counts, the at-gates and blocked counts, and the Testing and Development plan counts, each from plan 1's counts, asserted in a unit test.
- The slice strip's five states add up to the plan's slice count, and "1 / 5 delivered" matches `sliceProgress`, asserted in a unit test.
- The Owner column shows the owning sprint's Owner, or "—".
- An opened plan lists every slice under exactly one of Done, In flight and To do per the mapping table; an in-flight slice links to its row elsewhere instead of repeating it.
- A Done line shows its PR and its merge date from the PR index, or the named commit's date.
- No slice without a branch and without an agent shows as a Work items row, and a To do slice that can start carries Start.
- Several target releases show one block each; no target release lists every plan approved for delivery.
- In release scope, one card per sprint owner shows that sprint's progress.
- With **My sprint** on, the section's title and plans follow the reader's sprint scope, grouped by sprint where the reader owns several.

### Settled Questions

- Every slice waits on plan 1's `feature/delivery-section-header`, directly or through another slice. Writer's call, from the design's plan order.
- Plan 1 owns the five-state classification; this plan reads it. Writer's call, from the round-1 panel.
- This plan owns the removal of not-started slices from Work items, and gives them Start. Writer's call, from the round-1 panel.

### Open Questions

- [x] In the opened list, which date does a Done slice show where the host reports no `mergedAt` for it (a slice completed by a named commit)? Resolved: the named commit's date, from local git.
- [x] [Contradiction, Deliverable] `feature/delivery-release-person-cards` reads sprint Owners but waits only on `feature/delivery-section-header`. Resolved: it waits on `feature/sprint-owner-field` and `feature/delivery-release-plan-rows`.
- [x] [Contradiction, Deliverable] The sprint-scope slice's marker names only `feature/delivery-my-sprint-scope`. Resolved: it waits on `feature/delivery-my-sprint-scope` and `feature/delivery-release-plan-rows`, and plan 1's scope slice now carries its own waits.
- [x] [Estate] A Release delivery section already exists. Resolved: the plan-rows slice replaces `deliveredBlocks` and `releaseLines`, removes `release-delivery` from `COLLAPSED_BY_DEFAULT`, and changes the `delivery-view` tests that pin the old shape.
- [x] [Estate, Contradiction] The five-state classification is built twice. Resolved: plan 1's `feature/delivery-slice-states` builds it once; this plan reads it.
- [x] [Estate] `sliceProgress` already defines "N of M slices merged" and excludes deferred-only slices. Resolved: "1 / 5 delivered" reads it, and a deferred-only slice counts in neither number.
- [x] [Contradiction, Deliverable] The plan-row **Owner** column has no stated source. Resolved: the Owner of the sprint that names the plan, or "—".
- [x] [Contradiction] "Blocked" and "at a gate" depend on plans 2 and 3. Resolved: the plan-rows slice waits on plan 1's slice states (which waits on plan 2's groups) and on plan 3's gates slice.
- [x] [Contradiction] "A slice listed here always has its row in Work items or You" contradicts "a slice that has not started shows only in its plan's opened list". Resolved: the guarantee covers in-flight slices; Done and To do slices have no row elsewhere.
- [x] [Contradiction, Deliverable] Done When does not say where an at-a-gate or blocked slice goes. Resolved: the mapping table puts at a gate, being built and blocked under In flight.
- [x] [Deliverable] The Changelog and Done When omit the header counts, the per-release blocks and the person cards. Resolved: each has a Changelog and a Done When line.
- [x] [Deliverable] Split the plan-rows and person-cards slices? Resolved: the per-release blocks move to the plan-rows slice, which builds the section's structure; the person cards stay a slice of their own.
- [x] [Deliverable, Cost] No slice carries a per-slice merge date or PR link. Resolved: the plan-rows slice adds both from the PR index and local git, with no new host call.
- [x] [Cost, Deliverable] The Board impact line says to rebuild the board artifact with each slice. Resolved: the rebuild is a local test only.
- [x] [Cost] The plan-rows and person-cards slices edit the same module and wait on the same slice. Resolved: the person cards wait on the plan rows.
- [x] [Cost] No claim is made about the payload. Resolved: a few kilobytes for about 40 slices.

### Left to the Builder

- How the per-person cards wrap on narrow screens.
- The names of the new domain facts and their types, within the domain's terminology (Slice, not Wave).

## Slices

### Plan rows

- `feature/delivery-release-plan-rows` <!-- waits: feature/delivery-slice-states, feature/delivery-work-items-gates --> — the Release delivery header, one block per target release, one collapsed row per plan with its slice strip and Owner, the opened Done / In flight / To do list with merge dates, links and Start, and not-started slices out of Work items <!-- builds: a slice strip and a plan's grouped slice list -->

### Person cards

- `feature/delivery-release-person-cards` <!-- waits: feature/delivery-release-plan-rows, feature/sprint-owner-field --> — one progress card per sprint owner in release scope <!-- builds: per-person sprint progress cards -->

### Sprint scope

- `feature/delivery-sprint-delivery-scope` <!-- waits: feature/delivery-my-sprint-scope, feature/delivery-release-plan-rows --> — Sprint delivery under the **My sprint** toggle, with plans grouped by sprint where the reader owns several <!-- builds: Sprint delivery scope for the delivery section -->

## Notes

- Created by `/plot-idea` in one batch with plans 1 to 4 and 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "slice strip" and "per-person progress" found no artifact of that name. The existing section (`deliveredBlocks`, `releaseLines`) and `sliceProgress` exist and are replaced or read as the Approach says.
- Amended after the round-1 panel, 2026-11-16: the slice states move to plan 1, the not-started exclusion and Start move here from plan 3, and every slice carries its waits.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "engine": "panel",
  "questionHistory": [],
  "deferredItems": [],
  "categoriesCovered": {}
}
END-CHALLENGE-THE-PLAN-METADATA -->

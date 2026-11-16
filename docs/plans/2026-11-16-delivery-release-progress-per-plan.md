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
- **Rounds:** 2

## Changelog

- **Release delivery** shows one row per plan (Plan · Phase · Slices · Owner), collapsed by default, with a slice strip of one block per slice coloured by state and "1 / 5 delivered".
- An opened plan row lists its slices under **Done**, **In flight** and **To do**; an in-flight slice links to its row in Work items or You, and a slice to do names what it waits for, with **Start** where it can start.
- The section header counts delivered and total slices, slices at gates and blocked, and plans in Testing and in Development, and replaces today's release line.
- Where the active sprints name several releases, the section shows one block per release; where none names one, it lists every plan approved for delivery.
- In release scope, one card per sprint owner shows each of their sprints and its slice progress, and one card holds the sprints with no Owner.
- With **My sprint** on, the section reads **Sprint delivery · <name>** and groups its plans by sprint where the reader owns several.
- A slice that has not started (no branch, no agent) leaves Work items and shows only in its plan's opened list.

Board impact: changes the Release delivery section in `packages/domain` and `packages/board`, and removes not-started slices from Work items; no change to the plan format, the template, the helper scripts or the `docs/plans` layout. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one, and `main` builds the bundle after the merge.

## Motivation

Plan 5 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: Release delivery lists every merged slice of every plan in Testing, about 40 rows where nothing needs anyone.

The design is canonical. This plan implements its *Release Delivery* section, the sprint-scope row of *The "My sprint" Toggle*, and the *Calls Made After Review* points listed below. It does not restate them.

## Design

### Approach

Depends on plan 1, `delivery-tab-header-and-my-sprint`, for the section-header pattern, the five-state slice classification (`feature/delivery-slice-states`), the sprint Owner field (`feature/sprint-owner-field`) and the scope rule (`feature/delivery-my-sprint-scope`); and on plan 3's `feature/delivery-work-items-groups`, whose rows the in-flight links target. Plan 2's Blocks delivery case reaches this plan through plan 1's slice-states slice, which waits on it.

- **The one place a plan's full slice list lives.** Release delivery stays outside the placement rule, as the 2026-11-08 design settled.
- **What exists.** A Release delivery section exists: `deliveredBlocks` and `releaseLines` (`agent-rows/delivery-view.ts:184-192, 410-439`), the `data-release-line` paragraph (`AgentList.tsx:1390`), and `release-delivery` in `COLLAPSED_BY_DEFAULT` (`agent-rows/collapse.ts:20`). The plan-rows slice replaces `deliveredBlocks` with the plan rows and `releaseLines` with the section header, and removes `release-delivery` from `COLLAPSED_BY_DEFAULT`, because the design keeps sections open and collapses only the plan row. The tests that pin the old shape change with it: `delivery-view.test.ts` and `delivery-readings.test.ts` for `deliveredBlocks` and `releaseLines`, and the tests of `expandSection` (`AgentList.tsx:416`) for the section's fold.
- **A stored fold.** `readCollapsed` keeps every stored key in `KNOWN_KEYS` (`collapse.ts:6-8`), which holds every section and group of `DELIVERY_LAYOUT`, so a reader who folded Release delivery before would keep it folded. The plan-rows slice narrows `KNOWN_KEYS` to the keys of the design's three collapsibles (a plan row, the Free agents line, a "… n more" line), so a stored `release-delivery` falls away on read; a unit test reads a stored `["release-delivery"]` as open.
- **Header.** "<delivered> of <total> slices delivered · <n> at gates · <n> blocked · <n> plans in Testing · <n> in Development", read from plan 1's slice-state counts and the plans' phases. It replaces the release line, whose blocked count plan 1's slice-states slice has already moved to the five-state count.
- **One row per plan:** Plan · Phase · Slices · Owner. This is the section's own column set; `ROW_COLUMNS` does not apply to it (plan 3's Approach states the same).
  - **Slices** is a slice strip: one block per slice in the five states of plan 1's classification (delivered, at a gate, being built, blocked, not started), which this plan reads and does not rebuild. **Blocked** means the slice meets a Blocks delivery case (*Calls Made After Review*, "The progress bar has five segments"), counted the same for every reader. "1 / 5 delivered" reads plan 1's delivered and total counts. Those are the one source: plan 1 decides delivered through the per-slice answer it exports from `slicesOf` (`rules/deliverable.ts:175`), the walk under `sliceProgress` (`:302`), so the text matches `sliceProgress`'s "N of M slices merged", and a deferred-only slice counts in neither number. Where the pulse is absent or its scan is incomplete, so `sliceProgress` answers `undefined`, the strip shows no blocks and the text "progress not read", never "0 / 5".
  - **Owner** is the Owner of the sprint that names the plan, from plan 1's `ownerHandle`. A plan that no sprint names, or whose sprint has no Owner, shows "—". A plan file carries no owner of its own, and the design's people are sprint owners (*Calls Made After Review*, "A sprint has an owner"). Writer's call.
- **Collapsed by default** (▸), one of the design's three collapsibles. Opened (▾), it lists every slice in order under one of three headings, mapped from the five states:

  | Slice state | Heading | Line |
  |---|---|---|
  | delivered | **Done** | ✓ merged, the slice, its PR, "merged 2 days ago" |
  | at a gate, being built | **In flight** | ⟳ at CI, ● building; the slice links to its row in Work items (At a gate, Being built or Queued) |
  | blocked | **In flight** | the slice links to its row in You › Blocks delivery, or in Work items where You does not admit it for this reader |
  | not started | **To do** | ○ waits, and what it waits for ("after Reads"); **Start** where the slice can start |

  An in-flight slice is not repeated here; its row lives in Work items or You. A Queued slice reads being built in plan 1's classification, so it is In flight and links to its Queued row.
- **The Done line.** A Done line takes its PR number and its `mergedAt` from the PR index, whose MERGED rows are terminal (*A Decision Reads The Index*), and adds no host call. Where no MERGED row names the slice's branch, the store is missing or reads `complete: false`, or `mergedAt` is empty, the line shows "✓ merged · <slice>" with no PR number and no date. On Bitbucket the row's `mergedAt` is the host's `updated_on` (`bitbucket-pr-row.ts:49`), and the line shows it as the host gave it. A slice completed by a named commit (`→ commit abc1234`) shows the commit's short hash and no date. The plan-rows slice adds the PR number and the date to the payload.
- **Not started and Start.** A slice that has not started (no branch, no agent) shows only in its plan's opened list, under To do. The plan-rows slice keeps those rows on the payload and stops placing them in Work items, through `isUnbegun` (`row-identity.ts:77`). The To do line reads the same row's `startability` field, which the server computes (`startabilityVerdict`) from the plan phase, the branch state, the slice verdict and the brief state, and which `isStartable` (`row-identity.ts:116`) reads today; the line shows today's **Start** (`dispatch`) control (`AgentList.tsx:1219`) where `isStartable` is true. A wait on a slice in another plan reaches the line through the slice verdict the pulse computes, and the line names the earlier slice from the row's `blockedBy` (`schema.ts:3195`). The plan-rows slice asserts the cross-plan case in a unit test. Start is never off the tab.
- **The scope rule and To do.** *Calls Made After Review* says a slice listed here always has its row in Work items or You, and the *Release Delivery* section says a slice that has not started shows only here. Both hold when the guarantee covers the slices in flight: a Done slice and a To do slice have no row elsewhere, and every In flight slice has exactly one.
- **Releases.** Where the active sprints name different `Release:` values, the section shows one block per release; where no sprint names a release, it lists every plan approved for delivery (*Calls Made After Review*, "One status card per target release").
- **Progress per person** (release scope only). One small card per sprint owner, with one progress bar per sprint that owner owns, from plan 1's per-sprint slice-state counts. The release's people are the owners of the sprints that name that release. Sprints with no Owner count toward the release and show on one card labelled "no owner". A person with no Active sprint has no card.
- **Sprint scope.** With **My sprint** on, the section reads **Sprint delivery · <name>**; where the reader owns several Active sprints, it groups its plans by sprint. The scope rule is plan 1's, and this plan's sprint-scope slice is the only one that narrows and renames this section. Mine narrows this section too.
- **Payload.** About 40 slices across 8 plans add a PR number and a date per Done slice: a few kilobytes on the fleet payload.
- **Domain first.** Every strip segment, heading, waits-for value, Start eligibility, person card and header count is a domain property with a unit test.

### Done When

Per slice, in slice order.

- *Plan rows:* a release with 40 merged slices across 8 plans shows 8 collapsed rows, not 40, in a section that is open, also for a reader who stored a fold of it; the header shows the delivered and total slice counts, the at-gates and blocked counts, and the Testing and Development plan counts, from plan 1's counts, and the release line is gone; the strip's five states add up to the plan's slice count, "1 / 5 delivered" matches `sliceProgress`, and an unread pulse shows "progress not read", each asserted in a unit test; the Owner column shows the owning sprint's Owner, or "—"; an opened plan lists every slice under exactly one of Done, In flight and To do per the mapping table, and an in-flight slice, a Queued one included, links to its row elsewhere instead of repeating it; a Done line shows its PR and merge date from the PR index, the bare "✓ merged" text where the index has none, or a named commit's hash; no slice without a branch and without an agent shows as a Work items row, and a To do slice whose row reads startable carries Start, a cross-plan wait included; several target releases show one block each, and no target release lists every plan approved for delivery.
- *Person cards:* in release scope, one card per sprint owner shows a bar per sprint they own, and one "no owner" card holds the sprints with no Owner.
- *Sprint scope:* with **My sprint** on, the section's title and plans follow the reader's sprint scope, grouped by sprint where the reader owns several.

### Settled Questions

- Every slice waits on plan 1's `feature/delivery-section-header`, directly or through another slice. Writer's call, from the design's plan order.
- Plan 1 owns the five-state classification; this plan reads it. Writer's call, from the round-1 panel.
- This plan owns the removal of not-started slices from Work items, and gives them Start. Writer's call, from the round-1 panel.
- Plan 1 owns the scope rule; this plan's sprint-scope slice applies it to Release delivery. Writer's call, from the round-2 panel.

### Open Questions

- [x] In the opened list, which date does a Done slice show where the host reports no `mergedAt` for it (a slice completed by a named commit)? Resolved in round 2: no date; the line shows the commit's short hash.
- [x] [Contradiction, Deliverable] `feature/delivery-release-person-cards` reads sprint Owners but waits only on `feature/delivery-section-header`. Resolved: it comes after the plan-rows slice, which waits on `feature/sprint-owner-field`.
- [x] [Contradiction, Deliverable] The sprint-scope slice's marker names only `feature/delivery-my-sprint-scope`. Resolved: it waits on `feature/delivery-my-sprint-scope` and on this plan's person-cards slice.
- [x] [Estate] A Release delivery section already exists. Resolved: the plan-rows slice replaces `deliveredBlocks` and `releaseLines`, removes `release-delivery` from `COLLAPSED_BY_DEFAULT`, and changes the tests that pin the old shape.
- [x] [Estate, Contradiction] The five-state classification is built twice. Resolved: plan 1's `feature/delivery-slice-states` builds it once; this plan reads it.
- [x] [Estate] `sliceProgress` already defines "N of M slices merged" and excludes deferred-only slices. Resolved: "1 / 5 delivered" reads plan 1's counts, which decide delivered through the same walk, and a deferred-only slice counts in neither number.
- [x] [Contradiction, Deliverable] The plan-row **Owner** column has no stated source. Resolved: the Owner of the sprint that names the plan, or "—".
- [x] [Contradiction] "Blocked" and "at a gate" depend on plans 2 and 3. Resolved: the plan-rows slice waits on plan 1's slice states (which waits on plan 2's groups) and on plan 3's groups slice.
- [x] [Contradiction] "A slice listed here always has its row in Work items or You" contradicts "a slice that has not started shows only in its plan's opened list". Resolved: the guarantee covers in-flight slices; Done and To do slices have no row elsewhere.
- [x] [Contradiction, Deliverable] Done When does not say where an at-a-gate or blocked slice goes. Resolved: the mapping table puts at a gate, being built and blocked under In flight.
- [x] [Deliverable] The Changelog and Done When omit the header counts, the per-release blocks and the person cards. Resolved: each has a Changelog and a Done When line.
- [x] [Deliverable] Split the plan-rows and person-cards slices? Resolved: the per-release blocks move to the plan-rows slice, which builds the section's structure; the person cards stay a slice of their own.
- [x] [Deliverable, Cost] No slice carries a per-slice merge date or PR link. Resolved: the plan-rows slice adds both from the PR index, with no new host call.
- [x] [Cost, Deliverable] The Board impact line says to rebuild the board artifact with each slice. Resolved: the rebuild is a local test only.
- [x] [Cost] The plan-rows and person-cards slices edit the same module. Resolved: the person cards come after the plan rows.
- [x] [Cost] No claim is made about the payload. Resolved: a few kilobytes for about 40 slices.
- [x] [Estate, Deliverable] `feature/delivery-release-plan-rows` reads the sprint Owner and `Release:` but no chain reaches `feature/sprint-owner-field`. Resolved: the plan-rows slice waits on `feature/sprint-owner-field`.
- [x] [Contradiction, Estate] Start moves to the To do line, but `isStartable` reads `startability` on the rows `isUnbegun` removes. Resolved: the rows stay on the payload and leave only the Work items placement; the To do line reads the same row's server-computed `startability`, and a cross-plan wait counts through the pulse's slice verdict, asserted in a unit test.
- [x] [Deliverable, Estate] `sliceProgress` returns a string, and its counts live in the unexported `slicesOf`. Resolved: plan 1's classification is the one source of counts and exports the per-slice merge answer from `deliverable.ts`; an unread pulse shows "progress not read".
- [x] [Deliverable, Cost] Plan 3's Queued slices fit none of the five states. Resolved: plan 1's classification counts a Queued slice as being built, so it shows under In flight and links to its Queued row.
- [x] [Deliverable, Cost, Estate] A Done line has no text for a MERGED slice with no index row, a missing or `complete: false` store, or an empty `mergedAt`. Resolved: the line shows "✓ merged · <slice>" with no PR number and no date; a Bitbucket `mergedAt` is the host's `updated_on`, shown as given.
- [x] [Cost] The named-commit date needs a new `Refs` operation (`ports/refs.ts:138-146` holds `BranchDate` only). Resolved: dropped. The line shows the commit's short hash and no date, because a new port operation and one git spawn per plan with named commits buy a date only for slices completed by a direct push, and the short hash already names the commit.
- [x] [Contradiction, Deliverable, Estate] Plan 1's `feature/delivery-my-sprint-scope` also scoped Release delivery. Resolved: plan 1's scope slice now scopes the status card, You and Work items only; this plan's sprint-scope slice narrows and renames Release delivery, and waits on plan 1's.
- [x] [Deliverable] One card per team member or per sprint owner? Resolved: one card per sprint owner with a bar per sprint they own, and one "no owner" card for the sprints with no Owner, which count toward the release.
- [x] [Cost] The person-cards and sprint-scope slices both edit the Release delivery module and do not wait on each other. Resolved: slices in one plan run in heading order, and the sprint-scope slice's `waits:` marker names the person-cards slice.
- [x] [Contradiction] Plan 3 says Release delivery rows keep `ROW_COLUMNS`. Resolved: this plan's Plan · Phase · Slices · Owner holds, and plan 3's Approach now says so.
- [x] [Deliverable, Estate] A stored collapse key keeps Release delivery folded, and the tests that pin the old shape are unnamed. Resolved: the plan-rows slice narrows `KNOWN_KEYS` so a stored `release-delivery` falls away, and names `delivery-view.test.ts`, `delivery-readings.test.ts` and the `expandSection` tests.

### Left to the Builder

- How the per-person cards wrap on narrow screens.
- How an opened plan row is stored, under the existing `plot-board:agents:collapsed` key (`collapse.ts:41`), with its own unit test.
- The names of the new domain facts and their types, within the domain's terminology (Slice, not Wave).

## Slices

### Plan rows

- `feature/delivery-release-plan-rows` <!-- waits: feature/delivery-slice-states, feature/delivery-work-items-groups, feature/sprint-owner-field --> — the Release delivery header in the place of the release line, one block per target release, one collapsed row per plan with its slice strip and Owner, the opened Done / In flight / To do list with PR numbers, merge dates, links and Start, not-started slices out of Work items, and the narrowed collapse keys <!-- builds: a slice strip and a plan's grouped slice list -->

### Person cards

- `feature/delivery-release-person-cards` <!-- waits: feature/delivery-release-plan-rows --> — one progress card per sprint owner, with a bar per sprint, and one "no owner" card, in release scope <!-- builds: per-person sprint progress cards -->

### Sprint scope

- `feature/delivery-sprint-delivery-scope` <!-- waits: feature/delivery-my-sprint-scope, feature/delivery-release-person-cards --> — Sprint delivery under the **My sprint** toggle, with plans grouped by sprint where the reader owns several <!-- builds: Sprint delivery scope for the delivery section -->

## Notes

- Created by `/plot-idea` in one batch with plans 1 to 4 and 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "slice strip" and "per-person progress" found no artifact of that name. The existing section (`deliveredBlocks`, `releaseLines`) and `sliceProgress` exist and are replaced or read as the Approach says.
- Slices in one plan run in heading order: a slice is eligible once every earlier slice has merged.
- Amended after the round-1 panel, 2026-11-16: the slice states move to plan 1, the not-started exclusion and Start move here from plan 3, and every slice carries its waits.
- Amended after the round-2 panel (`.plot/panels/delivery-release-progress-per-plan/r2-panel.md`), 2026-11-16: the plan-rows slice waits on the sprint Owner field, Start reads the rows' own `startability`, the counts come from plan 1 alone, a Queued slice is In flight, the Done line has a defined fallback, the named-commit date is dropped, plan 1 no longer scopes this section, the person cards have a unit, and a stored fold falls away.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "engine": "panel",
  "questionHistory": [],
  "deferredItems": [],
  "categoriesCovered": {}
}
END-CHALLENGE-THE-PLAN-METADATA -->

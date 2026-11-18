# Delivery tab: the tab header and the My sprint toggle

> The Delivery tab opens on a to-do list of what the reader blocks, a release or sprint status card with the Approve button, and a fleet card; the **My sprint** toggle switches the tab between release scope and the reader's own sprint; and every section gains the one header shape the later plans use.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:**
- **Issue:**
- **Story:** delivery-tab-reads-at-a-glance
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Started:** 2026-11-17, Jan Wloka, `feature/delivery-section-header`
- **Started:** 2026-11-17, Jan Wloka, `feature/sprint-owner-field`
- **Started:** 2026-11-17, Jan Wloka, `feature/delivery-fleet-card`
- **Started:** 2026-11-17, Jan Wloka, `feature/delivery-slice-states`
- **Started:** 2026-11-18, Jan Wloka, `feature/delivery-sprint-card`

## Changelog

- The Delivery tab header shows a to-do list ("You block N things"), one line per thing the reader blocks, verb first, each marked **blocks delivery**, **input** or **clean up**.
- A status card shows the target release with a five-segment progress bar and the **Approve release** button, or, with **My sprint** on, the reader's sprint with its end date, its release, its progress bar and its MoSCoW tiers.
- The release row leaves Work items and You: the release card and its to-do line are its one place, and a release PR that no sprint targets still gets a card with its Approve button.
- A fleet card shows idle, working or blocked, with counts and the fleet switches read-only.
- The **This sprint** filter is renamed **My sprint**. It switches the status card, You and Work items to the Active sprints the reader owns, and it is disabled with the tooltip "You own no active sprint" when the reader owns none.
- A sprint file accepts `- **Owner:** <handle>` in its Status block, and `/plot-sprint` writes the creating person's handle there.
- Every Delivery section opens with one header line of counts, each linking to its group, and a group with no rows does not show.
- Each slice gets one of five delivery states (delivered, at a gate, being built, blocked, not started), counted per plan, per release and per sprint.

Board impact: the sprint template, `/plot-sprint` and the sprint parser gain an `Owner:` field, and the fleet payload's sprint gains its Owner and its end date; the Delivery tab gains a header, cards and a section-header component, and loses the release row and the per-sprint report line. No change to the plan format, the plan template or the `docs/plans` layout. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one, and `main` builds the bundle after the merge. The template change needs a `plot-sprint` bump in its changeset.

## Motivation

Plan 1 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: the tab has no place that answers "what is the status of the release" or "am I the blocker", and no section header summarises its body.

The design is canonical. This plan implements its *Page Structure* (*Every section has one shape*), *The "My sprint" Toggle* and *Tab Header* sections, and the *Calls Made After Review* points listed below. It does not restate them.

## Design

### Approach

Approach A of the design: evolve the current tab in place.

- **Section header pattern.** One domain summary per section: the section's name, its icon, and a list of counts, each with the group it links to. A group with no rows carries a count of 0 and renders no body. The section header component renders that summary, lists no items, and has one right-aligned controls slot, which plan 4 fills with the fleet switches. `SectionView` (`agent-rows/delivery-view.ts:159-168`) already holds a section's icon, label and count; the summary extends it and builds no second one. The icons move from the emoji in `SECTION_LABELS` (`delivery-view.ts:23-30`) to `packages/board/src/app/lib/glyphs.ts`. This plan applies the pattern to the sections as they stand, with the counts each section already holds; the Fleet header's working, blocked and free counts come from today's `agentGroup` groups (`delivery-placement.ts:262-267`). Plans 2 to 6 fill the counts for their sections.
- **Sprint owner.** `skills/plot/templates/sprint.md` gains `- **Owner:** <handle>` in its Status block, and `/plot-sprint` writes the creating person's handle there. The sprint parser (`packages/domain/src/rules/sprint-record.ts`) reads the handle as a string and does not check it, because the domain package cannot read `People`. The fact is named `ownerHandle` on the sprint record; the name `SprintOwner` is taken by the `Sprint owner` config key's type (`rules/issue-source.ts:116`), and no new type takes it. The board server checks the handle against the person directory it already builds from `People` (`server-info.ts:179`, `parsePersonDirectory`): a handle that `People` does not declare reads as no owner, and the sprint card names the unknown handle. The parser never refuses a sprint file for its Owner. A sprint with no Owner counts toward the release and belongs to nobody's toggle (*Calls Made After Review*, "A sprint has an owner").
- **Sprint end date.** `FleetSprintSchema` (`packages/board/src/contract/schema.ts:4269`) carries `start`, `timebox` and `timeboxLabel` and no end date, while `sprintRecordOf` already parses `end`. The sprint-owner slice adds `ownerHandle` and `end` to the fleet payload's sprint, with their schema defaults, `mock-fleet.ts`, `fleet.ts` and the fixtures, so the sprint card can write "ends Friday, 20 November".
- **Who owns a sprint.** A domain rule answers whether the reader owns a sprint, in the sprint-owner slice, so the sprint card and the scope slice both read it. It compares as PR ownership compares (`prOwnership`, `rules/ownership.ts:103-109`): `samePerson(resolvePerson(<reader's host login>, directory), resolvePerson(<ownerHandle>, directory))`, over the `Reader` (`ownership.ts:19-29`) and its `People` directory. A reader with no host login (`readerIsKnown`, `ownership.ts:316`, reads false) or whose login does not resolve to the Owner owns no sprint.
- **My sprint scope.** A domain rule answers the scope from the toggle, the reader and the Active sprints: the release (every team member's sprints together) or the Active sprints the reader owns, combined. This plan applies the scope to the status card, You and Work items; plan 5's `feature/delivery-sprint-delivery-scope` applies the same rule to Release delivery and renames it, and waits on this plan's scope slice, so the rule is built once. Fleet and Tickets stay unscoped (*Calls Made After Review*, "One scope rule for every section"). The Mine filter keeps its three modes and narrows Work items and Release delivery only (*Calls Made After Review*, "You always means the reader").
- **The disabled toggle.** The button is disabled with the tooltip "You own no active sprint" when the reader owns no Active sprint, which includes the case where no sprint is Active at all (Jan Wloka, 2026-11-16). This replaces `sprintChip`'s "No sprint is Active." (`packages/domain/src/rules/chip-row.ts:115-121`). The per-sprint chips and the `?sprint=` selection (`chip-row.ts`, `DeliveryFilters.tsx` `selectedSprints`) stay, and narrow the scope while it is on.
- **The rename.** The chip's label changes from **This sprint** to **My sprint** in `chip-row.ts:117,120` and in `DeliveryFilters.tsx:120`, and its `data-chip` value changes with it. This reverses the decision recorded at `DeliveryFilters.tsx:63-65` (`data-chip` stays "This sprint" so its tests keep working), and the scope slice rewrites that comment. The scope slice updates the files that select `[data-chip="This sprint"]`: four browser test files (`sprint-switch`, `agents-tab`, `sprint-exempt`, `delivery-filters`) and three unit test files (`chip-readings.test.ts`, `chip-row.test.ts`, `filtered-estate-totals.test.ts`).
- **Slice states.** One domain classification gives each slice exactly one of the five states the progress bar and the slice strip use (*Calls Made After Review*, "The progress bar has five segments"). It decides in this order, so every slice gets one state and the five counts add up to the total:
  1. **delivered** — the slice counts as merged, as `sliceProgress` (`rules/deliverable.ts:302`) counts it through the walk in `slicesOf` (`deliverable.ts:175`). The slice-states slice exports that per-slice answer from `deliverable.ts` and reuses it; it writes no second merge rule.
  2. **blocked** — the slice's item meets a Blocks delivery case in plan 2's reason table (`feature/delivery-you-groups`). The case is read from the item alone, before ownership and the Mine filter decide whether the reader sees it under You, so every reader counts the same blocked slices from the same payload.
  3. **at a gate** — the slice has an open PR, or a hold (`heldBy`), the cases Work items › At a gate holds.
  4. **being built** — the slice has a branch or a claim. This includes plan 3's Work items › Queued slices (a branch or a claim and no live agent).
  5. **not started** — every other slice: no branch, no claim, no agent (`isUnbegun`, `agent-rows/row-identity.ts:77`).

  A deferred-only slice counts in no state and not in the total, as `sliceProgress` excludes it. The rule runs where the tab's placement runs: in the client, over the payload the tab already holds, through a domain function with a unit test (`placeDelivery` is called only in `AgentList.tsx:1088` and `delivery-view.ts:447`). It adds no server work and no payload field. This plan owns the classification and its counts per plan, per release and per sprint; plan 5's slice strip reads it and builds no second one. The slice-states slice also changes the Release delivery line's "blocked" count (`delivery-view.ts:416`, today You › Unblock) to the five-state Blocked count, so "blocked" has one meaning from that merge on; plan 5's plan-rows slice replaces that line.
- **To-do list.** One line per thing the reader blocks, verb first (Interrogate, Review, Approve, Release or delete), most urgent on top, each line marked **blocks delivery**, **input** or **clean up**. Its header counts the three markers apart: "You block 1 delivery · the fleet waits for 2 inputs · 2 to clean up" (*Calls Made After Review*, "Unblock rows carry a third marker"). Plan 2's `feature/delivery-you-groups` decides the marker of every You reason; the to-do list reads that table and decides no marker itself. Below the list one line counts the reader's tickets with no plan and links **triage** to the Tickets section, which plan 6's `feature/delivery-tickets-section` builds.
- **Release card.** A progress bar in five segments whose segments add up to the total, the number of people whose sprints form the release (the owners of the sprints that name it), the release's state, and the **Approve release** button (`ReleaseApprove.tsx`). The to-do list carries "Approve release <version>" as a line with the marker plan 2's table gives `release-approval` (blocks delivery), and the line links to the card. Where the active sprints name different `Release:` values, the header shows one card per value; where none names a release, the card reads "No release targeted" (*Calls Made After Review*, "One status card per target release").
- **Approve per release row.** A card binds the release row whose version equals the card's `Release:` value. The version is the one the board already reads: `AgentRow.version`, read from `package.json` on the `changeset-release/<base>` branch (`schema.ts:2685-2705`, `releaseVersion` in `tuple-row.ts`). Changesets opens one release PR per base branch, so at most one card binds a PR. A card whose value no release row carries shows its button disabled, with the reason "no release PR carries <version>". **A release row that no card binds gets a card of its own**, "Release <version> · no sprint targets it", with an enabled Approve button. So the button exists wherever a release PR exists, with no Active sprint as well: the release row's only Approve button today moves to a card and is never removed without one. The match is a domain rule with a unit test, and it reads only the release row already on the payload, so it adds no host call.
- **The release leaves the rows.** The release row under Work items › At a gate and the `release-approval` row under You go away in the release-card slice; the release lives on the status card and the to-do line (*Changes to the 2026-11-08 Design*). Plan 2 keeps `release-approval` in Blocks delivery until then, so the release shows in exactly one place at every merge.
- **Sprint card.** The end date written in full ("ends Friday, 20 November"), the release it targets, a progress bar, and progress per MoSCoW tier (Must 5/5 · Should 2/3 · Could 0/2). Where the reader owns several Active sprints, the card shows one progress bar per sprint. The per-sprint report line (`data-sprint-report`, `DeliveryFilters.tsx:183`) goes away in the scope slice, when the toggle that shows the card ships; until then it stays, so a sprint's timebox is never off the tab.
- **Fleet card.** Idle, working or blocked, with counts (free, working, blocked) and the fleet switches shown read-only, linking down to the Fleet section header's `#fleet-controls` anchor. The card renders the same switch components as the Fleet header (`FleetControls.tsx`) in a read-only mode, so the switch state has one source.
- **Domain first.** Every count, marker, segment, binding and disabled state is a domain property with a unit test (CLAUDE.md, "Every rendered state is a domain property"). Browser tests prove only what is seen.
- **Constraints.** No horizontal scroll at 320 px; light and dark themes both read; icons only from `glyphs.ts`; text is never abbreviated while the row has room for it.

### Done When

Per slice, in slice order.

- *Section header:* every Delivery section shows one header line of linked counts with its icon from `glyphs.ts`, and a group with no rows does not show; the Fleet header counts working, blocked and free.
- *Sprint owner:* a sprint file with `- **Owner:** <handle>` parses, and `/plot-sprint` writes it; a sprint with no Owner, or with a handle `People` does not declare, counts toward the release and belongs to no toggle; the fleet payload's sprint carries `ownerHandle` and `end`; the ownership rule answers true only where the reader's host login and the Owner resolve to one person, asserted in unit tests.
- *Fleet card:* the fleet card shows the state, the three counts and the switches read-only, and links to `#fleet-controls`.
- *Slice states:* each slice gets exactly one of the five states, a Queued slice reads being built, and the five counts add up to the total, asserted in unit tests per plan, per release and per sprint; two readers with different identities get the same counts from one payload; the Release delivery line's blocked count is the five-state count.
- *Sprint card:* the sprint card shows the end date written in full, the target release, a bar per owned Active sprint, and the MoSCoW tier counts.
- *To-do list:* the header counts blocks delivery, input and clean up apart, each line carries the marker plan 2's table gives its reason, and the triage line counts the reader's tickets with no plan and links to the Tickets section.
- *Release card:* one card shows per target `Release:` value and per release row no value names; a card bound to a release row has an Approve button bound to that row's PR and head, an unbound card's button is disabled with its reason, and "No release targeted" shows where no sprint names a release and no release row exists, each asserted in a unit test; the release shows on no row under You or Work items, and with no Active sprint a release PR still has an enabled Approve button.
- *Sprint scope:* the toggle switches the status card, You and Work items, carries `data-chip="My sprint"`, and is disabled with the tooltip "You own no active sprint" when the reader owns no Active sprint, including when none is Active; the per-sprint report line is gone.
- Every count, marker, bar segment and disabled state has a unit test; browser tests prove only what is seen.

### Settled Questions

- This plan lays the section-header pattern that plans 2 to 6 use, so their slices wait on `feature/delivery-section-header`. Writer's call, from the design's plan order.
- The plan names no `Issue:`; the story names issue #3468. Writer's call: six plans writing their phase to one issue would overwrite each other's plan-state comment.
- This plan owns the five-state slice classification (`feature/delivery-slice-states`); plan 5 reads it. Writer's call, from the round-1 panel.
- Plan 2 owns the marker per You reason; the to-do list reads it (`feature/delivery-tab-todo-list` waits on `feature/delivery-you-groups`). Writer's call, from the round-1 panel.
- **Blocked** is read from the item's Blocks delivery case before ownership, so the release bar is the same for every reader. Writer's call, from the round-2 panel: the release counts every team member's sprints, and a reader-relative count would make one release read differently per viewer.

### Open Questions

- [x] Where the reader is not in `People`, which handle does **My sprint** compare against the sprint's Owner? Resolved: the reader's host login, resolved over `People` as `prOwnership` resolves it; a reader with no login, or whose login does not resolve to the Owner, owns no sprint.
- [x] The story file and issue #3468 do not exist on this branch. Resolved: the story is on `main` (`643b88d08`, after this branch's base) and names issue #3468; the link resolves once this branch merges.
- [x] Slices 2 to 4 carry no `<!-- waits: -->` marker. Resolved: every slice carries its waits, within this plan and across plans 2, 3 and 6.
- [x] A reader who owns no Active sprint while another person's sprint is Active. Resolved (Jan Wloka, 2026-11-16): the toggle is disabled with the tooltip "You own no active sprint", also when no sprint is Active. The per-sprint chips and `?sprint=` stay and narrow the scope while it is on. No Owner backfill is needed: no sprint is Active on 2026-11-16, and new sprints get the field from the template and `/plot-sprint`.
- [x] The rename keeps or changes `data-chip="This sprint"`. Resolved: `data-chip` changes to `My sprint`, which reverses `DeliveryFilters.tsx:63-65`; the scope slice rewrites that comment and updates the four browser test files and three unit test files named in the Approach.
- [x] The header-cards slice holds six views. Resolved: it is split into the fleet card, slice-states, sprint card, to-do list and release card slices.
- [x] Plan 2 and this plan both define the to-do markers. Resolved: plan 2 owns the marker per reason and this plan reads it; this plan owns the slice-state classification and plan 5 reads it.
- [x] One **Approve release** button per `Release:` value needs a rule that maps a value to a release PR. Resolved: a card binds the release row whose `version` equals its value; every other card's button is disabled with a reason; a release row no value names gets its own card.
- [x] The sprint card needs an end date, but `FleetSprintSchema` has no `end` field. Resolved: the sprint-owner slice adds `end` to the fleet payload's sprint.
- [x] "Checked against `People`" sits in the sprint parser, which cannot read `People`. Resolved: the board server checks the handle against its person directory; an undeclared handle reads as no owner and is named on the card, and the parser never refuses the file.
- [x] The fleet card and the Fleet section header both show the fleet switches. Resolved: both render `FleetControls.tsx`, the card in a read-only mode; the Fleet header is plan 4's.
- [x] The Board impact line says to rebuild the board artifact with each slice. Resolved: the rebuild is a local test only, and no slice commits a bundle.
- [x] [Domain] The tab already renders a sprint line (`data-sprint-report`, `DeliveryFilters.tsx:183`) and a release line (`data-release-line`, `AgentList.tsx:1390`, built in `delivery-view.ts:411-423`). Resolved: the scope slice removes the sprint line; the slice-states slice gives the release line the five-state Blocked count, and plan 5's `feature/delivery-release-plan-rows` replaces the line with its section header.
- [x] [Domain] The five slice states do not cover plan 3's Queued group. Resolved: the classification decides in a fixed order, and a Queued slice (a branch or a claim, no live agent) reads being built, so the five states are total; `feature/delivery-slice-states` needs no wait on plan 3.
- [x] [Technical] "Blocked" reads `placeDelivery`, which only client code calls and which takes the reader's filters. Resolved: the classification runs in the client over the payload, and reads the item's Blocks delivery case before ownership and Mine, so it is reader-independent and adds no server work.
- [x] [Domain] The release-card slice removes the release row, which holds the only **Approve release** button today. Resolved: a release row that no card binds gets a card of its own with an enabled button, so a release PR always has one; the to-do line reads `release-approval`'s marker from plan 2's table.
- [x] [Technical] The sprint card needs the Owner-to-reader rule that the scope slice built one wave later. Resolved: the rule moves into `feature/sprint-owner-field`.
- [x] [Cost] This plan is eight serial merges. Resolved: the sprint card moves before the to-do list and the release card, because it waits on fewer slices; Notes states the chain.
- [x] [Domain] `SprintOwner` already names the type of the `Sprint owner` config key (`issue-source.ts:116`). Resolved: the per-sprint fact is `ownerHandle`, and no new type is named `SprintOwner`. Plans 1 and 5 no longer both scope the delivery section: plan 5's sprint-scope slice applies this plan's rule to Release delivery.
- [x] [Deliverable] Stale citations and Changelog omissions. Resolved: the citations above are re-read against `main` at `f0dfed71a`; the Changelog, Board impact and Done When name the release row's removal, the slice states and the `/plot-sprint` write; the icons come from `glyphs.ts`.

### Left to the Builder

- The names of the new domain facts and their types, within the domain's terminology (Slice, Agent, Worker), except `ownerHandle` and the ban on `SprintOwner`.
- Colours, spacing and chip styles within the board's palette; how a count link scrolls to and highlights its group.

## Slices

### Section header

- `feature/delivery-section-header` — the domain section summary (name, icon from `glyphs.ts`, counts with their group targets, empty groups hidden) extending `SectionView`, and the section header component with its controls slot, applied to every Delivery section as it stands <!-- builds: a Delivery section summary and its header component --> → #3484

### Sprint owner

- `feature/sprint-owner-field` — `- **Owner:** <handle>` in the sprint template, `/plot-sprint` and the sprint parser as `ownerHandle`; `ownerHandle` and `end` on the fleet payload's sprint; the board's check of the handle against `People`; the rule that answers whether the reader owns a sprint <!-- builds: a sprint Owner field, the sprint end date on the fleet payload, and a sprint ownership rule --> → #3490

### Fleet card

- `feature/delivery-fleet-card` <!-- waits: feature/delivery-section-header --> — the fleet card with its state, counts and read-only switches from `FleetControls.tsx`, linking to `#fleet-controls` <!-- builds: a Delivery tab fleet card --> → #3491

### Slice states

- `feature/delivery-slice-states` <!-- waits: feature/delivery-you-groups --> — the five-state slice classification in its fixed order, with its counts per plan, per release and per sprint, the per-slice merge answer exported from `deliverable.ts`, and the five-state Blocked count on the Release delivery line <!-- builds: a five-state slice delivery classification --> → #3513

### Sprint card

- `feature/delivery-sprint-card` <!-- waits: feature/delivery-slice-states, feature/sprint-owner-field --> — the sprint card with its end date, target release, a bar per owned Active sprint and the MoSCoW tier counts <!-- builds: a sprint status card -->

### To-do list

- `feature/delivery-tab-todo-list` <!-- waits: feature/delivery-section-header, feature/delivery-you-groups, feature/delivery-tickets-section --> — the to-do list with its three markers read from plan 2's table, its header counts, and the triage line linking to the Tickets section <!-- builds: the Delivery tab to-do list -->

### Release card

- `feature/delivery-release-card` <!-- waits: feature/delivery-slice-states, feature/sprint-owner-field, feature/delivery-tab-todo-list --> — one release card per target release and per unbound release row, with the five-segment bar, the people count, the state and the Approve button bound by version, "No release targeted", the "Approve release" to-do line, and the release out of You and Work items <!-- builds: release status cards with Approve release -->

### Sprint scope

- `feature/delivery-my-sprint-scope` <!-- waits: feature/delivery-release-card, feature/delivery-sprint-card, feature/delivery-work-items-groups --> — the **My sprint** toggle: the rename and its `data-chip` test updates, the scope rule over the Active sprints the reader owns, the disabled state with "You own no active sprint", the scope applied to the status card, You and Work items, and the per-sprint report line removed <!-- builds: a Delivery scope rule for release or my sprint -->

## Notes

- Created by `/plot-idea` in one batch with plans 2 to 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "sprint Owner field", "section header", "to-do list", "My sprint", "fleet card" and "release card" found no artifact of that name. The search missed `SprintOwner` (`issue-source.ts:116`), the `Sprint owner` config key's type, which is why the new fact is `ownerHandle`.
- The slices run in heading order, and each `waits:` marker adds a slice in another plan. The longest chain across the six plans is nine merges: this plan's eight slices in heading order, then plan 5's `feature/delivery-sprint-delivery-scope`. The cross-plan waits of the slice states (plan 2's groups), the to-do list (plan 6's tickets) and the scope (plan 3's groups) each sit on shorter chains and do not lengthen it.
- Amended after the round-1 panel (`.plot/panels/delivery-tab-header-and-my-sprint/panel.md`), 2026-11-16: the header-cards slice is split, the slice states move here from plan 5, and every slice carries its waits.
- Amended after the round-2 panel (`.plot/panels/delivery-tab-header-and-my-sprint/r2-panel.md`) and Jan Wloka's decisions, 2026-11-16: the five states decide in a fixed order and are total, Blocked is reader-independent, an unbound release row gets its own card, the ownership rule moves into the sprint-owner slice, the sprint card moves before the to-do list, Release delivery's scope moves to plan 5, and the toggle is disabled for a reader who owns no Active sprint.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "engine": "panel",
  "panel": ".plot/panels/delivery-tab-header-and-my-sprint/r2-panel.md",
  "questionHistory": [],
  "deferredItems": [
    {"q": "Which handle does My sprint compare for a reader not in People?", "category": "domain", "context": "Sprint owner"}
  ],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": false
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

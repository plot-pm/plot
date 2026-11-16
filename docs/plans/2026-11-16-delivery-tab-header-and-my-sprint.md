# Delivery tab: the tab header and the My sprint toggle

> The Delivery tab opens on a to-do list of what the reader blocks, a release or sprint status card with the Approve button, and a fleet card; the **My sprint** toggle switches the tab between release scope and the reader's own sprint; and every section gains the one header shape the later plans use.

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

- The Delivery tab header shows a to-do list ("You block N things"), one line per thing the reader blocks, verb first, each marked **blocks delivery**, **input** or **clean up**.
- A status card shows the target release with a five-segment progress bar and the **Approve release** button, or, with **My sprint** on, the reader's sprint with its end date, its release, its progress bar and its MoSCoW tiers.
- A fleet card shows idle, working or blocked, with counts and the fleet switches read-only.
- The **This sprint** filter is renamed **My sprint**. It switches the status card, the delivery section, You and Work items to the reader's own Active sprints, and it is disabled with a tooltip when no sprint is active.
- A sprint file accepts `- **Owner:** <handle>` in its Status block, and `/plot-sprint` writes it.
- Every Delivery section opens with one header line of counts, each linking to its group, and a group with no rows does not show.

Board impact: the sprint template and the sprint parser gain an `Owner:` field, and the fleet payload's sprint gains its end date; the Delivery tab gains a header, cards and a section-header component. No change to the plan format, the plan template or the `docs/plans` layout. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one, and `main` builds the bundle after the merge.

## Motivation

Plan 1 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: the tab has no place that answers "what is the status of the release" or "am I the blocker", and no section header summarises its body.

The design is canonical. This plan implements its *Page Structure* (*Every section has one shape*), *The "My sprint" Toggle* and *Tab Header* sections, and the *Calls Made After Review* points listed below. It does not restate them.

## Design

### Approach

Approach A of the design: evolve the current tab in place.

- **Section header pattern.** One domain summary per section: the section's name, its icon, and a list of counts, each with the group it links to. A group with no rows carries a count of 0 and renders no body. The section header component renders that summary, lists no items, and has one right-aligned controls slot, which plan 4 fills with the fleet switches. Plans 2 to 6 fill the counts for their sections; this plan applies the pattern to the sections as they stand, with the counts each section already holds.
- **Sprint owner.** `skills/plot/templates/sprint.md` gains `- **Owner:** <handle>` in its Status block, and `/plot-sprint` writes the creating person's handle there. The sprint parser (`packages/domain/src/rules/sprint-record.ts`) reads the handle as a string and does not check it, because the domain package cannot read `People`. The board server checks it against the person directory it already builds from `People` (`server-info.ts:170`, `parsePersonDirectory`): a handle that `People` does not declare reads as no owner, and the sprint card names the unknown handle. The parser never refuses a sprint file for its Owner. A sprint with no Owner counts toward the release and belongs to nobody's toggle (*Calls Made After Review*, "A sprint has an owner").
- **Sprint end date.** `FleetSprintSchema` (`packages/board/src/contract/schema.ts:4269`) carries `start`, `timebox` and `timeboxLabel` and no end date, while `sprintRecordOf` already parses `end`. The sprint-owner slice adds `end` to the fleet payload's sprint, with its schema default and fixtures, so the sprint card can write "ends Friday, 20 November".
- **The reader.** **My sprint** compares a sprint's Owner with the reader as the board already resolves the reader: `Reader` (`ownership.ts:23-30`, `hostUser`, `gitEmail`) through `resolvePerson` over `People` (`entities/person.ts`), the same path `readerIsKnown` (`agent-rows/mine-filter.ts`) uses. A reader that `People` does not resolve owns no sprint.
- **My sprint scope.** A domain rule answers the scope from the toggle, the reader and the Active sprints: the release (every team member's sprints together) or the reader's own Active sprints combined. The scope applies to the status card, Release delivery, You and Work items alike; Fleet and Tickets stay unscoped (*Calls Made After Review*, "One scope rule for every section"). The button is disabled with a tooltip when no sprint is Active, as the design's toggle section says and as `sprintChip` does today (`chip-row.ts:116-117`). The Mine filter keeps its three modes and narrows Work items and Release delivery only (*Calls Made After Review*, "You always means the reader").
- **The rename.** The button in `DeliveryFilters.tsx` changes its label from **This sprint** to **My sprint**, and its `data-chip` value changes with it. The scope slice updates the files that select `[data-chip="This sprint"]`: four browser test files (`sprint-switch`, `agents-tab`, `sprint-exempt`, `delivery-filters`) and three unit test files (`chip-readings.test.ts`, `chip-row.test.ts`, `filtered-estate-totals.test.ts`).
- **Slice states.** One domain classification gives each slice one of the five states the progress bar and the slice strip use: delivered, at a gate, being built, blocked, not started (*Calls Made After Review*, "The progress bar has five segments"). **Blocked** means the slice sits under You › Blocks delivery, which plan 2's `feature/delivery-you-groups` decides; **at a gate** and **being built** are today's Work items groups; **delivered** counts as `sliceProgress` (`rules/deliverable.ts`) counts a merged slice, and a deferred-only slice counts in no state and not in the total, as `sliceProgress` excludes it. This plan owns the classification and its counts per plan, per release and per sprint; plan 5's slice strip reads it and builds no second one.
- **To-do list.** One line per thing the reader blocks, verb first (Interrogate, Review, Approve, Release or delete), most urgent on top, each line marked **blocks delivery**, **input** or **clean up**. Its header counts the three markers apart: "You block 1 delivery · the fleet waits for 2 inputs · 2 to clean up" (*Calls Made After Review*, "Unblock rows carry a third marker"). Plan 2's `feature/delivery-you-groups` decides the marker of every You row; the to-do list reads that rule and decides no marker itself, so its slice waits on that branch. Below the list one line counts the reader's tickets with no plan and links **triage** to the Tickets section, which plan 6's `feature/delivery-tickets-section` builds.
- **Release card.** A progress bar in five segments whose segments add up to the total, the number of people whose sprints form the release (the owners of the sprints that name it), the release's state, and the **Approve release** button (`ReleaseApprove.tsx`). The to-do list carries "Approve release <version>" as a blocks-delivery line that links to the card. Where the active sprints name different `Release:` values, the header shows one card per value; where none names a release, the card reads "No release targeted" (*Calls Made After Review*, "One status card per target release").
- **Approve per `Release:` value.** A card binds the release row whose version equals the card's `Release:` value. The version is the one the board already reads: `AgentRow.version`, read from `package.json` on the `changeset-release/<base>` branch (`schema.ts:2685-2705`, `releaseVersion` in `tuple-row.ts`). Changesets opens one release PR per base branch, so at most one card binds a PR. A card whose value no release row carries shows its button disabled, with the reason "no release PR carries <version>". The match is a domain rule with a unit test, and it reads only the release row already on the payload, so it adds no host call.
- **The release leaves the rows.** The release row under Work items › At a gate and the `release-approval` row under You go away; the release lives on the status card and the to-do line (*Changes to the 2026-11-08 Design*). Plan 2 keeps `release-approval` in Blocks delivery until the release-card slice removes it, so the release shows in exactly one place at every merge.
- **Sprint card.** The end date written in full ("ends Friday, 20 November"), the release it targets, a progress bar, and progress per MoSCoW tier (Must 5/5 · Should 2/3 · Could 0/2). Where the reader owns several Active sprints, the card shows one progress bar per sprint.
- **Fleet card.** Idle, working or blocked, with counts (free, working, blocked) and the fleet switches shown read-only, linking down to the Fleet section header's `#fleet-controls` anchor. The card renders the same switch components as the Fleet header (`FleetControls.tsx`) in a read-only mode, so the switch state has one source.
- **Domain first.** Every count, marker, segment, binding and disabled state is a domain property with a unit test (CLAUDE.md, "Every rendered state is a domain property"). Browser tests prove only what is seen.
- **Constraints.** No horizontal scroll at 320 px; light and dark themes both read; icons only from `packages/board/src/app/lib/glyphs.ts`; text is never abbreviated while the row has room for it.

### Done When

- A developer who opens the tab reads the release or sprint status and the count of what they block from the header alone.
- Every Delivery section shows one header line of linked counts, and a group with no rows does not show.
- A sprint file with `- **Owner:** <handle>` parses; a sprint with no Owner, or with a handle `People` does not declare, counts toward the release and belongs to no toggle; the fleet payload's sprint carries its end date.
- Each slice gets exactly one of the five states, and the five counts add up to the total, asserted in unit tests per plan, per release and per sprint.
- The to-do list header counts blocks delivery, input and clean up apart, and each line carries the marker plan 2's rule gives its row.
- The triage line counts the reader's tickets with no plan and links to the Tickets section.
- One release card shows per target `Release:` value; the card whose value a release row carries has an Approve button bound to that row's PR and head, every other card's button is disabled with its reason, and "No release targeted" shows where no sprint names a release, each asserted in a unit test.
- The release shows on no row under You or Work items.
- The sprint card shows the end date written in full, the target release, a bar per owned Active sprint, and the MoSCoW tier counts.
- The fleet card shows the state, the three counts and the switches read-only, and links to `#fleet-controls`.
- The toggle switches the status card, Release delivery, You and Work items, is disabled with a tooltip when no sprint is Active, and carries `data-chip="My sprint"`.
- Every count, marker, bar segment and disabled state has a unit test; browser tests prove only what is seen.

### Settled Questions

- This plan lays the section-header pattern that plans 2 to 6 use, so their slices wait on `feature/delivery-section-header`. Writer's call, from the design's plan order.
- The plan names no `Issue:`; the story names issue #3468. Writer's call: six plans writing their phase to one issue would overwrite each other's plan-state comment.
- This plan owns the five-state slice classification (`feature/delivery-slice-states`); plan 5 reads it. Writer's call, from the round-1 panel.
- Plan 2 owns the You marker per row; the to-do list reads it (`feature/delivery-tab-todo-list` waits on `feature/delivery-you-groups`). Writer's call, from the round-1 panel.

### Open Questions

- [x] Where the reader is not in `People`, which handle does **My sprint** compare against the sprint's Owner? Resolved: the reader as `resolvePerson` resolves it over `People` (`hostUser`, then `gitEmail`), the path `readerIsKnown` uses; an unresolved reader owns no sprint.
- [x] The story file and issue #3468 do not exist on this branch. Resolved: the story is on `main` (`643b88d08`, after this branch's base) and names issue #3468; the link resolves once this branch merges.
- [x] Slices 2 to 4 carry no `<!-- waits: -->` marker. Resolved: every slice now carries its waits, within this plan and across plans 2, 3 and 6.
- [ ] The design disables **My sprint** only when no sprint is Active, and also defines My sprint as the Active sprints the reader owns. The design is silent on a reader who owns no Active sprint while another person's sprint is Active. This plan follows the design's disabled rule, so that reader can switch on an empty scope. Question for Jan Wloka: does the toggle stay enabled for that reader, with an empty scope that says "you own no Active sprint", or is it disabled with that tooltip? The per-sprint chips and the `?sprint=` selection (`chip-row.ts:105-120`, `DeliveryFilters.tsx` `selectedSprints`) are also not named in the design. This plan keeps them and lets them narrow the scope that is on; Jan Wloka can overturn that. The Owner backfill is not needed: no sprint is Active on 2026-11-16, and new sprints get the field from the template and `/plot-sprint`.
- [x] The rename keeps or changes `data-chip="This sprint"`. Resolved: `data-chip` changes to `My sprint`, and the scope slice updates the four browser test files and three unit test files named in the Approach.
- [x] The header-cards slice holds six views. Resolved: it is split into the fleet card, slice-states, to-do list, release card and sprint card slices. Slices run in heading order, so the fleet card, which waits on nothing outside this plan, comes before the slices that wait on plans 2, 3 and 6.
- [x] Plan 2 and this plan both define the to-do markers. Resolved: plan 2 owns the marker per row and this plan reads it; this plan owns the slice-state classification and plan 5 reads it.
- [x] One **Approve release** button per `Release:` value needs a rule that maps a value to a release PR. Resolved: a card binds the release row whose `version` (read from `package.json` on `changeset-release/<base>`) equals its value; every other card's button is disabled with a reason.
- [x] The sprint card needs an end date, but `FleetSprintSchema` has no `end` field. Resolved: the sprint-owner slice adds `end` to the fleet payload's sprint.
- [x] "Checked against `People`" sits in the sprint parser, which cannot read `People`. Resolved: the board server checks the handle against its person directory; an undeclared handle reads as no owner and is named on the card, and the parser never refuses the file.
- [x] The fleet card and the Fleet section header both show the fleet switches. Resolved: both render `FleetControls.tsx`, the card in a read-only mode; the Fleet header is plan 4's. The scope slice waits on plan 3's gates slice, and plan 2's groups through the release card.
- [x] The Board impact line says to rebuild the board artifact with each slice. Resolved: the rebuild is a local test only, and no slice commits a bundle.

### Left to the Builder

- The names of the new domain facts and their types, within the domain's terminology (Slice, Agent, Worker).
- Colours, spacing and chip styles within the board's palette; how a count link scrolls to and highlights its group.

## Slices

### Section header

- `feature/delivery-section-header` — the domain section summary (name, icon, counts with their group targets, empty groups hidden) and the section header component with its controls slot, applied to every Delivery section as it stands <!-- builds: a Delivery section summary and its header component -->

### Sprint owner

- `feature/sprint-owner-field` — `- **Owner:** <handle>` in the sprint template, `/plot-sprint` and the sprint parser; the Owner and the end date on the board payload; the board's check of the handle against `People` <!-- builds: a sprint Owner field and the sprint end date on the fleet payload -->

### Fleet card

- `feature/delivery-fleet-card` <!-- waits: feature/delivery-section-header --> — the fleet card with its state, counts and read-only switches from `FleetControls.tsx`, linking to `#fleet-controls` <!-- builds: a Delivery tab fleet card -->

### Slice states

- `feature/delivery-slice-states` <!-- waits: feature/delivery-you-groups --> — the five-state slice classification with its counts per plan, per release and per sprint, as domain facts on the payload <!-- builds: a five-state slice delivery classification -->

### To-do list

- `feature/delivery-tab-todo-list` <!-- waits: feature/delivery-section-header, feature/delivery-you-groups, feature/delivery-tickets-section --> — the to-do list with its three markers read from plan 2's rule, its header counts, and the triage line linking to the Tickets section <!-- builds: the Delivery tab to-do list -->

### Release card

- `feature/delivery-release-card` <!-- waits: feature/delivery-slice-states, feature/sprint-owner-field, feature/delivery-tab-todo-list --> — one release card per target release with the five-segment bar, the people count, the state and the Approve button bound by version, "No release targeted", the "Approve release" to-do line, and the release out of You and Work items <!-- builds: release status cards with Approve release -->

### Sprint card

- `feature/delivery-sprint-card` <!-- waits: feature/delivery-slice-states, feature/sprint-owner-field --> — the sprint card with its end date, target release, a bar per owned Active sprint and the MoSCoW tier counts <!-- builds: a sprint status card -->

### Sprint scope

- `feature/delivery-my-sprint-scope` <!-- waits: feature/delivery-release-card, feature/delivery-sprint-card, feature/delivery-work-items-gates --> — the **My sprint** toggle: the rename and its `data-chip` test updates, the scope rule over the reader's Active sprints, its disabled state and tooltip, and the scope applied to the status card, Release delivery, You and Work items <!-- builds: a Delivery scope rule for release or my sprint -->

## Notes

- Created by `/plot-idea` in one batch with plans 2 to 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "sprint Owner field", "section header", "to-do list", "My sprint", "fleet card" and "release card" found no artifact of that name in the estate.
- Amended after the round-1 panel (`.plot/panels/delivery-tab-header-and-my-sprint/panel.md`), 2026-11-16: the header-cards slice is split, the slice states move here from plan 5, and every slice carries its waits.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "engine": "panel",
  "panel": ".plot/panels/delivery-tab-header-and-my-sprint/panel.md",
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

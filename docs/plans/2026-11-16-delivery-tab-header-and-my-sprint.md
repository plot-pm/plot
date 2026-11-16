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

## Changelog

- The Delivery tab header shows a to-do list ("You block N things"), one line per thing the reader blocks, verb first, each marked **blocks delivery**, **input** or **clean up**.
- A status card shows the target release with a five-segment progress bar and the **Approve release** button, or, with **My sprint** on, the reader's sprint with its end date, its release, its progress bar and its MoSCoW tiers.
- A fleet card shows idle, working or blocked, with counts and the fleet switches read-only.
- The **This sprint** filter is renamed **My sprint**. It switches the status card, the delivery section, You and Work items to the reader's own Active sprints, and it is disabled with a tooltip when no sprint is active.
- A sprint file accepts `- **Owner:** <handle>` in its Status block.
- Every Delivery section opens with one header line of counts, each linking to its group, and a group with no rows does not show.

Board impact: the sprint template and the sprint parser gain an `Owner:` field; the Delivery tab gains a header, cards and a section-header component. No change to the plan format, the plan template or the `docs/plans` layout. Rebuild the board artifact (`pnpm build:board`) with each slice that changes the board.

## Motivation

Plan 1 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: the tab has no place that answers "what is the status of the release" or "am I the blocker", and no section header summarises its body.

The design is canonical. This plan implements its *Page Structure* (*Every section has one shape*), *The "My sprint" Toggle* and *Tab Header* sections, and the *Calls Made After Review* points listed below. It does not restate them.

## Design

### Approach

Approach A of the design: evolve the current tab in place.

- **Section header pattern.** One domain summary per section: the section's name, its icon, and a list of counts, each with the group it links to. A group with no rows carries a count of 0 and renders no body. The section header component renders that summary and lists no items. Plans 2 to 6 fill it for their sections; this plan applies it to the sections as they stand, with the counts each section already holds.
- **Sprint owner.** `skills/plot/templates/sprint.md` gains `- **Owner:** <handle>` in its Status block, a handle the `People` config key declares. The sprint parser (`packages/domain/src/rules/sprint-record.ts`) reads it, and the board carries it. A sprint with no Owner counts toward the release and belongs to nobody's toggle (*Calls Made After Review*, "A sprint has an owner").
- **My sprint scope.** A domain rule answers the scope from the toggle, the reader and the Active sprints: the release (every team member's sprints together) or the reader's own Active sprints combined. The scope applies to the status card, Release delivery, You and Work items alike; Fleet and Tickets stay unscoped (*Calls Made After Review*, "One scope rule for every section"). The toggle is disabled when the reader owns no Active sprint, and its tooltip says so. The button in `DeliveryFilters.tsx` is renamed from **This sprint** to **My sprint**.
- **To-do list.** One line per thing the reader blocks, verb first (Interrogate, Review, Approve, Release or delete), most urgent on top, each line marked **blocks delivery**, **input** or **clean up**. Its header counts the three markers apart: "You block 1 delivery · the fleet waits for 2 inputs · 2 to clean up" (*Calls Made After Review*, "Unblock rows carry a third marker"). Below the list one line counts the reader's tickets with no plan and links **triage** to the Tickets section. Plan 2 decides the markers per row; this plan reads them through the rule plan 2 refines, and until then from today's You groups.
- **Release card.** A progress bar in five segments (delivered, at a gate, being built, blocked, not started) whose segments add up to the total, the number of people whose sprints form the release (the owners of the sprints that name it), the release's state, and the **Approve release** button (`ReleaseApprove.tsx`). The to-do list carries "Approve release <version>" as a blocks-delivery line that links to the card. Where the active sprints name different `Release:` values, the header shows one card per value; where none names a release, the card reads "No release targeted" (*Calls Made After Review*, "One status card per target release" and "The progress bar has five segments").
- **Sprint card.** The end date written in full ("ends Friday, 20 November"), the release it targets, a progress bar, and progress per MoSCoW tier (Must 5/5 · Should 2/3 · Could 0/2). Where the reader owns several Active sprints, the card shows one progress bar per sprint.
- **Fleet card.** Idle, working or blocked, with counts (free, working, blocked) and the fleet switches shown read-only, linking down to the Fleet section header.
- **The release row** under Work items › At a gate goes away; the release lives on the status card (*Changes to the 2026-11-08 Design*).
- **Domain first.** Every count, marker, segment and disabled state is a domain property with a unit test (CLAUDE.md, "Every rendered state is a domain property"). Browser tests prove only what is seen.
- **Constraints.** No horizontal scroll at 320 px; light and dark themes both read; icons only from `packages/board/src/app/lib/glyphs.ts`; text is never abbreviated while the row has room for it.

### Done When

- A developer who opens the tab reads the release or sprint status and the count of what they block from the header alone.
- The toggle switches the status card, Release delivery, You and Work items, and it is disabled with a tooltip when the reader owns no Active sprint.
- Every Delivery section shows one header line of linked counts, and a group with no rows does not show.
- A sprint file with `- **Owner:** <handle>` parses, and a sprint with no Owner counts toward the release only.
- Every count, marker, bar segment and disabled state has a unit test; browser tests prove only what is seen.

### Settled Questions

- This plan lays the section-header pattern that plans 2 to 6 use, so their slices wait on `feature/delivery-section-header`. Writer's call, from the design's plan order.
- The plan names no `Issue:`; the story names issue #3468. Writer's call: six plans writing their phase to one issue would overwrite each other's plan-state comment.

### Open Questions

- [ ] Where the reader is not in `People`, which handle does **My sprint** compare against the sprint's Owner: the git user name, or no handle (toggle disabled)?

### Left to the Builder

- The names of the new domain facts and their types, within the domain's terminology (Slice, Agent, Worker).
- Colours, spacing and chip styles within the board's palette; how a count link scrolls to and highlights its group.

## Slices

### Section header

- `feature/delivery-section-header` — the domain section summary (name, icon, counts with their group targets, empty groups hidden) and the section header component, applied to every Delivery section as it stands <!-- builds: a Delivery section summary and its header component -->

### Sprint owner

- `feature/sprint-owner-field` — `- **Owner:** <handle>` in the sprint template, the sprint parser and the board payload, checked against `People` <!-- builds: a sprint Owner field -->

### Header cards

- `feature/delivery-tab-header-cards` — the to-do list with its three markers and the triage line, the release card with its five-segment bar and Approve button (one card per target release), the sprint card, the fleet card, and removal of the release row from Work items <!-- builds: Delivery tab header facts and cards -->

### Sprint scope

- `feature/delivery-my-sprint-scope` — the **My sprint** toggle: the scope rule over the reader's Active sprints, its disabled state and tooltip, and the scope applied to the status card, Release delivery, You and Work items <!-- builds: a Delivery scope rule for release or my sprint -->

## Notes

- Created by `/plot-idea` in one batch with plans 2 to 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "sprint Owner field", "section header", "to-do list", "My sprint", "fleet card" and "release card" found no artifact of that name in the estate.

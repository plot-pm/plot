# Sprint: Delivery UI Polish

> The Delivery tab shows where delivery stands at a glance and lets a user act on each item in one step.

## Status

- **State:** Active
- **Start:** 2026-11-20
- **End:** 2026-11-21
- **Owner:** jwloka
<!-- Optional. The version this sprint is working toward, named before it is
     cut. With it, /plot-release refuses to cut past an unfinished Must Have
     and asks about unfinished Should Haves. Without it, nothing changes. -->
- **Release:** 2.36.0

## Sprint Goal

Users of the Delivery tab did not understand what they can do and what they must do. The tab answers with words and punctuation where a number, a colour or a verb would do, cuts status text off, shows controls that cannot be used, and shows the same subject twice. This sprint gives the tab one summary header in five groups, seven sections that each fold to a visual summary, rows that start with what to do and link every artifact as a tuple, one ⋯ menu in a fixed last column, a Tickets section that shows what the sprint delivers and what it found, and three activity signals with fixed meanings.

Design spec (outside the repo): `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md`, with mockups in the folder next to it.

### Must Have
- [x] [delivery-link-tuples-everywhere] Every artifact on the Delivery tab is a linked tuple <!-- pr: #3583, branch: feature/delivery-tuple-vocabulary -->
- [x] [every-delivery-section-folds] Every Delivery section folds and says why it is empty <!-- pr: #3583, branch: feature/delivery-section-empty-kinds -->
- [ ] [folded-sections-summarise-visually] A folded Delivery section shows what it holds in counters and bars <!-- pr: #3583, branch: feature/folded-sections-summarise-visually -->
- [ ] [delivery-tab-has-one-header] The Delivery tab has one header in five groups <!-- pr: #3583, branch: feature/delivery-header-release-group -->
- [ ] [delivery-rows-act-from-one-place] Every Delivery row keeps its actions in one ⋯ menu in the last column <!-- pr: #3583, branch: feature/delivery-row-menu-column -->
- [ ] [tickets-show-what-the-sprint-delivers-and-found] The Tickets section shows what the sprint delivers and what it found <!-- pr: #3583, branch: feature/scope-ticket-rows-in-the-payload -->

<!-- An item is `- [ ] <description>`. A leading `[<plan-slug>]` names the plan
     it commits to, and only a plan slug is read as one: `- [ ] [#123](url) …`
     names an issue, so it is an item with no plan and is scored on its
     checkbox. Strike a reference — `~~[<plan-slug>]~~` — to mark an item that
     left the sprint; the plan's own state then says whether it was withdrawn. -->

### Should Have
- [ ] [delivery-activity-has-three-signals] Delivery activity shows as three signals with fixed meanings <!-- pr: #3583, branch: feature/delivery-activity-signals -->

<!-- add items here -->

### Could Have
- [x] [templates-show-named-identifiers] Templates show named identifiers

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

### Scope Changes
- 2026-11-21: Added [templates-show-named-identifiers] to Could — dispatched 2026-11-21; operator added it to count it in this sprint

<!-- Log scope changes here: added/removed items, tier changes, with date and reason -->
<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

<!-- Session log, decisions, links -->

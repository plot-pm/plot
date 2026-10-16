# Discovery and Planning cards show the work item's type and owner

> A ticket, story or plan card on the board shows a short type badge and an owner name, each read through a domain property, and shows nothing where the source holds no value.

## Status

- **State:** Delivered
- **Type:** feature
- **Issue:** #1750
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-15, Jan Wloka, plan-PR #1753 merged
- **Started:** 2026-10-15, Jan Wloka, `feature/ticket-cards-show-type-and-owner`
- **Started:** 2026-10-15, Jan Wloka, `feature/plan-and-story-cards-show-type-and-owner`
- **Delivered:** 2026-10-15

## Changelog

- Ticket, story and plan cards show a type badge (for example *bug* or *feature*) and an owner name. A card whose source holds no value shows no badge and no name.

Board impact: changes the board's Discovery and Planning cards and the row types the domain hands them. It may add `type` and `assignee` to the issue index row, which is a schema change, so a board running an older bundle must restart to read it.

## Motivation

Issue #1750 reports that no card in Discovery shows what kind of work it is or who owns it. A reader of the `ewz-kus-portal` board (Jira project `EWZKUS`) cannot tell a bug from a feature, or whose it is, without opening each item. `TicketLaneRow` carries `id`, `title`, `url`, `createdAt`, `status`, `statusCategory` and `closedAt` only. The plan's `Type:` field and its approval record exist in the plan file but no card displays them.

## Design

### Approach

One domain rule returns, for any card, a `{ type, owner }` pair of `string | null`. The card components render the two values and decide nothing (CLAUDE.md, *Every rendered state is a domain property*). A `null` renders as no badge or no name. The rule never substitutes a default or a guess.

Sources, one per kind of card:

| Card | Type | Owner |
|---|---|---|
| Ticket | The tracker's own type: the Jira issue type, or the GitHub issue type where the issue has one, otherwise absent | The assignee |
| Story | Absent unless a source is decided in the Open Questions | The story's author |
| Plan | The plan's `Type:` field | The author; once Approved, the approver from the `Approved:` record |

What each source needs:

- **Ticket type and assignee** are not on the issue index row today. `ticketSourceOf` in `packages/domain/src/adapters/tracker/tracker-listers.ts` already declares how each tracker writes its assignees, so the assignee read exists for the *Waiting on you* ownership rule. The Discovery rows need the type and the assignee carried onto `TicketSourceRow` and `TicketLaneRow` in `packages/domain/src/rules/ticket-lanes.ts`.
- **Plan type and approver** are in the plan file. The plan row already parses `Type:` and the `Approved:` record.
- **Plan author and story author** come from git history of the file (the commit that added it). This needs a reading the board does not take today.

A person's name goes through the `People` directory (`entities/person.ts`) where a handle is declared, so a Jira account and a GitHub login for one person show one name. An undeclared handle shows as written.

The badge text is the source's own word, lowercased, with no mapping table: a Jira type `Story` shows `story`, a Plot type `bug` shows `bug`. Colour is a presentation choice of the card.

### Open Questions

- [ ] Does a GitHub issue show its type from the issue-type field, from a label, or from both? The issue says "type or label". A label has no schema, so a label rule needs a declared mapping, for example a `Type labels` config key.
- [ ] Does a story have a type? The issue lists a story owner but no story type source.
- [ ] Is a plan's owner its author or its approver once Approved? The issue says both. One card shows one name, so the plan must decide which wins, or show both.
- [ ] Is the author read from the first commit that added the file, or from a field the plan template records? The first costs a git read per plan on every board refresh. The second needs a template change and leaves existing plans without an author.
- [ ] Does the widened issue-index row bump `PR_INDEX_VERSION`'s sibling for `issues.json`, so an older file reads as *no index* rather than as rows without owners?

## Slices

### Ticket type and owner

- `feature/ticket-cards-show-type-and-owner` → #1766 — carry type and assignee onto the ticket rows and render them on the Discovery ticket card <!-- builds: a ticket card's type and owner domain property -->

### Plan and story type and owner

- `feature/plan-and-story-cards-show-type-and-owner` → #1782 — read type, author and approver for plan and story cards and render them <!-- builds: a plan card's type and owner domain property -->

## Notes

Drafted from issue #1750 by `/plot-idea` unattended. `Review:` and `Impl:` took the defaults for a multi-slice board change, and the design question took its default of no. The Open Questions above are the decisions the issue left to this plan.

`docs/plans/2026-10-14-the-discovery-ticket-card-shows-its.md` (Released) set the scope limit "no labels and no author" for the ticket card. This plan lifts that limit on purpose.

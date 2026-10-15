# The Discovery ticket card shows its number, state and age, and offers Create plan and Create story

> A ticket row in the Discovery tab's ticket lanes shows the state icon, the ticket shorthand and title, a muted reference-and-age line, and the Create plan and Create story actions on open tickets.

## Status

- **State:** Released
- **Type:** feature
- **Issue:** #1689
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-14, Jan Wloka, plan-PR #1691 merged
- **Started:** 2026-10-14, jwloka, `feature/the-discovery-ticket-card-shows-its`
- **Delivered:** 2026-10-14
- **Released:** 2026-10-15, v2.27.0

## Changelog

- The Discovery tab's ticket rows show the ticket number, state and age, and offer *Create plan* and *Create story* on open tickets.

Board impact: changes the board's Discovery tab only. No change to the plan format, the template, the helper scripts, `plot-host.sh`, the issue index or the schema, so the board needs no restart.

## Motivation

`TicketRowView` in `packages/board/src/app/components/StoriesTab.tsx` renders the title as one link. A person cannot read a ticket's number, state or age, and cannot act on it from Discovery. The *Waiting on you* rows already show the state icon, and `CreatePlanButton` and `CreateStoryButton` already exist, so the data and the actions are on the board but not on this card.

## Design

### Approach

The card has the shape of a row in GitHub's issue list:

- **First line:** the state icon (open or closed, the icon the *Waiting on you* ticket rows use), then the shorthand as a prefix and the title, for example `1688: The Jira project scope: …`. A Jira ticket uses its key (`PROJ-12: …`). The title wraps to at most two lines and links to the ticket.
- **Second line, muted:** the repository or tracker reference and the age from `createdAt`, for example `plot-pm/plot#1688 · opened 10m ago`.
- **Actions:** *Create plan* and *Create story* on open tickets only. A Done ticket shows no action. Both buttons keep their arm-and-confirm interaction and their refusals.

Every text and state on the card comes from a domain property or a pure tested helper: the prefix, the reference, the age text, and which actions show. `TicketRowView` renders what the helper returns and decides nothing (CLAUDE.md, *Every rendered state is a domain property*). The helper takes the `TicketLaneRow` fields the board already carries (`id`, `title`, `url`, `createdAt`, `status`, `statusCategory`, `closedAt`) and a `now`, so a unit test fixes the clock.

Scope limit: only data the board already carries. The card shows no labels and no author. This needs no change to `plot-host.sh`, the issue index or the schema.

### Decisions

- **The reference comes from the ticket URL.** `TicketLaneRow` carries no repository name, so the helper derives the reference from `url`: a git-host issue URL gives `owner/repo#number`, a Jira browse URL gives the issue key. A URL the helper cannot read gives the shorthand alone, never an invented reference.
- **The helper maps the row for the buttons.** `CreatePlanButton` and `CreateStoryButton` take an `IssueRow`. The card helper maps the `TicketLaneRow` to the fields those buttons read, so `TicketRowView` passes the mapped row and decides nothing.
- **Open and In progress tickets show the actions.** Both lanes hold tickets that are open on the tracker; only the *Done* lane shows no action. Decided by the person on 2026-10-14.

## Slices

### Ticket card

- `feature/the-discovery-ticket-card-shows-its` — the card helper in the domain with unit tests, `TicketRowView` rendering it, and a browser test showing the card and both actions on an Open and an In progress ticket and no action on a Done ticket. <!-- builds: ticketCard, a pure helper for the Discovery ticket card's prefix, reference, age and actions --> → #1707

## Notes

- Source: issue #1689. The plan writes nothing to the tracker.

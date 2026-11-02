# A ticket row names its existing plan as text

> A ticket row whose plan exists names that plan through `PlanReference` and links it; a ticket with no plan keeps the inferred name as text.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #3040
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- A ticket row in "Assigned to you" and "Waiting on you" whose plan exists names that plan as `<issue keys>: <slug>` and links it to `/plan/<file>`, with the click behaviour of every other plan reference.
- A ticket row with no plan keeps the inferred name as text with no link.

<!-- Board impact: yes. This plan changes how the board renders the plan slot of a ticket row (packages/board/src/app/lib/agent-rows/rows.tsx) and adds a domain rule (packages/domain/src/rules/). It changes no plan format, template or helper script. A PR carries no generated bundle (scripts/check-no-bundle-diff.sh). -->

## Motivation

`rows.tsx:2913` renders the plan slot of every ticket row through `TupleLinkView` with `label: inferredPlanName(issue.title)` and `href: ''`. The comment at that site says "the plan does not exist". That holds for a ticket with no plan only.

Observed 2026-11-02: the row `3017: The board starts processe…` shows `the-board-starts-processes-on-the` at `in progress 2/4`, and the row `3006: Two test teardowns turn …` shows `two-test-teardowns-turn-main-red` at `delivered`. Both rows show a name as plain text with no issue prefix and no link, while the phase column of the same row reads the plan.

[`every-plan-reference-shows-its-issue`](2026-11-01-every-plan-reference-shows-its-issue.md) (#2993) states that the inferred plan on an issue row shows no link. It has no case for a ticket whose plan exists, and its rows slice (#3009) did not move this site to `PlanReference`.

## Design

### Approach

**A domain rule decides which plan a ticket names.** The rule takes the ticket and the plan index (`planIndexOf`, `rules/plan-reference.ts`) as values and answers one of two readings:

- the ticket has a plan: the answer is a `PlanRef` carrying that plan's file and slug, and the ticket row renders it with `planReference(ref, index)` and the `PlanReference` component;
- the ticket has no plan: the answer is the inferred name from `inferredPlanName(issue.title)`, which the row renders as text with no link, as it does today.

The `rows.tsx` site calls the rule and renders the answer. It decides nothing (CLAUDE.md, "Every rendered state is a domain property").

**Which plan a ticket names** is the plan whose `Issue:` field lists the ticket's key. The same plan metas and the same match already decide the phase column of the ticket row and drop the issue from the inbox (`ticketPlansOf`, `server/fleet.ts:1737`). The rule reuses that match and adds no second one.

**Tests.** Unit tests on the rule cover: a ticket with one plan, a ticket with a plan and no loaded index, a ticket with two plans, and a ticket with none. One browser test shows the link on a ticket row whose plan exists, and the text on one whose plan does not.

### Open Questions

- [ ] Where the plan index is not loaded yet, does the row link from the plan file the fleet payload carries, or show the inferred name until the index loads?
- [ ] A ticket named by two plans: does the row name the newest plan, or all of them?

## Slices

### Ticket plan

- `feature/a-ticket-row-names-its-existing` — domain rule for the plan a ticket names, and the ticket row renders it through `PlanReference` <!-- builds: ticketPlanReference, the rule that answers which plan a ticket row names -->

## Notes

- Source: tracker issue #3040. The plan writes nothing to the tracker.

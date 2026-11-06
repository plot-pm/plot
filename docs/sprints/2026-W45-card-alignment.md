# Sprint: Card alignment

> Every board card answers the same five questions in the same place.

## Status

- **State:** Active
- **Start:** 2026-11-06
- **End:** 2026-11-13
<!-- Optional. The version this sprint is working toward, named before it is
     cut. With it, /plot-release refuses to cut past an unfinished Must Have
     and asks about unfinished Should Haves. Without it, nothing changes. -->
- **Release:** 2.32.0

## Sprint Goal

Tickets, Stories and Plans cards on the board present the same work three
different ways, so a reader has to search each board for facts the other two
put elsewhere. This sprint makes the card grammar a domain concept — one
semantic model, `CardFacts`, presented by one shared card — and converts the
three boards to it: Plans first as the tracer, then Stories, then Tickets.

### Must Have
- [ ] [one-card-grammar] Tickets, Stories and Plans cards share one five-row card

<!-- An item is `- [ ] <description>`. A leading `[<plan-slug>]` names the plan
     it commits to, and only a plan slug is read as one: `- [ ] [#123](url) …`
     names an issue, so it is an item with no plan and is scored on its
     checkbox. Strike a reference — `~~[<plan-slug>]~~` — to mark an item that
     left the sprint; the plan's own state then says whether it was withdrawn. -->

### Should Have

<!-- add items here -->

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

### Scope Changes

<!-- Log scope changes here: added/removed items, tier changes, with date and reason -->
<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

<!-- Session log, decisions, links -->
- 2026-11-06: Created for `one-card-grammar` (docs/plans/2026-11-06-one-card-grammar.md,
  in Design on `idea/one-card-grammar`, PR #3192). The plan joins the sprint
  through `plot-sprint-member.mjs add card-alignment one-card-grammar` once its
  plan PR merges on approval — the writer sets the plan's `Sprint:` field, which
  it cannot do while the plan exists only on its idea branch.

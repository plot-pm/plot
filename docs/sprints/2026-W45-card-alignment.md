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
- [ ] [one-card-grammar] Tickets, Stories and Plans cards share one five-row card <!-- pr: #3192, branch: feature/one-card-grammar-plans -->

<!-- An item is `- [ ] <description>`. A leading `[<plan-slug>]` names the plan
     it commits to, and only a plan slug is read as one: `- [ ] [#123](url) …`
     names an issue, so it is an item with no plan and is scored on its
     checkbox. Strike a reference — `~~[<plan-slug>]~~` — to mark an item that
     left the sprint; the plan's own state then says whether it was withdrawn. -->

### Should Have
- [ ] [the-release-head-reports-validate-with] The release head reports validate with no person approving a run (#3073) <!-- pr: #3076, branch: bug/the-release-run-relays-validate --> <!-- reason: live proof failed on 2.31.0, merged: #3209, remaining: bug/the-release-run-relays-validate -->
- [x] [continue-and-the-agent-panel-refuse] continue and the agent panel refuse unknown-branch with no pulse (#3117) <!-- pr: #3129, branch: feature/continue-refuses-no-pulse -->
- [x] [controller-gate-refuses-read-only-commands] Controller gate refuses read-only commands that name a gated script (#2530) <!-- pr: #3135, branch: feature/controller-gate-reads-a-process-lookup -->
- [x] [open-plot-review-findings-from-the] Open plot-review findings from the 2026-10-29 delivery-loop plans (#3069) <!-- pr: #3075, branch: bug/a-high-gets-its-own-fixer-attempts -->
- [x] [partial-board-pulse-reported-as-unknown] Partial board pulse reported as unknown-branch (#3118) <!-- pr: #3127, branch: feature/partial-pulse-names-itself -->

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
- 2026-11-06: Added [the-release-head-reports-validate-with] to Should — carried from 2026-W45-follow-ups-2-30-1: the relay slice failed its live proof on 2.31.0; fix slice bug/the-release-run-relays-validate
- 2026-11-07: Added [continue-and-the-agent-panel-refuse] to Should — carried over from follow-ups-2-30-1 at its close: shipped in v2.31.0, release booking waits on #3213
- 2026-11-07: Added [controller-gate-refuses-read-only-commands] to Should — carried over from follow-ups-2-30-1 at its close: shipped in v2.31.0, release booking waits on #3213
- 2026-11-07: Added [open-plot-review-findings-from-the] to Should — carried over from follow-ups-2-30-1 at its close: shipped in v2.31.0, release booking waits on #3213
- 2026-11-07: Added [partial-board-pulse-reported-as-unknown] to Should — carried over from follow-ups-2-30-1 at its close: shipped in v2.31.0, release booking waits on #3213
  in Design on `idea/one-card-grammar`, PR #3192). The plan joins the sprint
  through `plot-sprint-member.mjs add card-alignment one-card-grammar` once its
  plan PR merges on approval — the writer sets the plan's `Sprint:` field, which
  it cannot do while the plan exists only on its idea branch.

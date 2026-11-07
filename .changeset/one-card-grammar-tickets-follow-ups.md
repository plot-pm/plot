---
'@plot-pm/board': patch
---

The `⋯` menu's Create plan now refuses a ticket whose card offers none: it says "a plan already answers this ticket", or "the ticket is done" in the done lane. A rejected or superseded plan no longer counts as answering its ticket in POST /api/idea, so the card and the endpoint agree and such a ticket can get a new plan. A ticket shows "stories unknown" while the ticket → story index cannot be built. The story brief, the story template and the story-tracking skill write the story's `issue:` as a quoted `"#N"`, and a Bitbucket issue URL that ends in its title segment is accepted. GET /api/issue answers 502 where the host call itself fails, where it never answered before.

<!--
bumps:
  skills:
    story-tracking: patch
plan: docs/plans/2026-11-06-one-card-grammar.md
-->

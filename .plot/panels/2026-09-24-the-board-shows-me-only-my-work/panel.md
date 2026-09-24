# Panel moderation — the-board-shows-me-only-my-work

**Reconciliation: `amend` — estate.**

**The direction survived every check.** No current-user concept, no prior ownership filter, `CardPrSchema` and `StorySchema.author` quoted exactly, both identity sources confirmed, the `collapse.ts` argument sound and — the juror notes — *stronger* than the plan states. Three measurement claims did not survive.

## The load-bearing correction: `Assignee:` is under-READ, not abandoned

**115 plan files carry an `Assignee:` line. The parser reports 71.** `plot-plan-meta.sh:863` gates the field on `section == "approval"`, so **44 plans writing it under `## Status` — the section both templates actually offer — are silently dropped.** Verified by the moderator.

So the field is on **35% of plans**, and a third of those are invisible to every consumer that asks the parser. The plan called it *"a parser reading a field nothing writes"*; the truth is closer to the opposite.

**Option A was rejected on evidence produced by the bug that makes the field look dead.** The rejection may still be right — the three spellings for two people survive the recount, and no template offers the field — but the word *abandoned* does not.

**That parser defect is a finding in its own right and belongs in its own ticket**, not folded into a filter plan.

## Slice 1's reading already exists

**`plot-host.sh:2557-2588`, `budget_account()`** answers *who is the current user* per backend — the GitHub arm reading `gh`'s `hosts.yml` (the juror ran it: `jwloka`), the Bitbucket arm deriving from `remote.origin.url`. Its comment even gives the reason the plan should have found: *"`gh api user` would answer authoritatively and cost one request against the very bucket this is counting."*

**The fifth plan today whose first slice already exists somewhere on the estate.** Slice 1 becomes *expose what `budget_account` knows*.

## The disposition

**Amend before building.** The filter's design, layering and storage choice all stand. What changes: the `Assignee:` framing, slice 1's scope, and a separate ticket for the parser.

# A Jira ticket with several assignees reads as theirs when the reader is not first

> `accountTicketOwnership` stops at the first declared assignee, so a ticket answers `theirs` or `mine` by assignee order; the fix checks every assignee and answers `mine` when any resolves to the reader.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2819
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- A Jira ticket assigned to several people, the reader among them, shows as the reader's own whatever the order of the assignees. «Mine» no longer hides it, and *Waiting on you* no longer drops it.

<!-- Board impact: none to the plan format, template, helper scripts or docs/plans layout. The change is a domain rule (`packages/domain/src/rules/ownership.ts`) that the board reads through `ticketOwnership`; the board artifact rebuilds from `main`. -->

## Motivation

Panel round 1 on #2811 (`.plot/panels/2026-10-28-mine-hides-rows-with-no-known/`) found it, and three jurors reproduced it in probes.

`accountTicketOwnership` (`packages/domain/src/rules/ownership.ts:153`) returns at the first assignee whose `<prefix><account>` spelling the directory declares. With `[mruepp, jan]` it answers `theirs`; with `[jan, mruepp]` it answers `mine`. The answer depends on assignee order, which contradicts the doc comment on `ticketOwnership` (`ownership.ts:176`): *"Every assignee is checked; any match is `mine`."* The `host-login` arm of the same function already follows that comment.

Effect on the board:

- **«Mine» on:** the reader's own ticket is hidden.
- **«Mine» off:** *Waiting on you* still drops the ticket. `waitingTickets` selects rows with `ownership === 'mine'` (`waiting-tickets.ts:223`), so a ticket that `accountMatches` would match (`waiting-tickets.ts:83-93`, which checks every assignee) is counted as hidden.

No test covers a `tracker-account` ticket with several assignees.

## Design

### Approach

Replace the early return in `accountTicketOwnership` with a pass over all assignees:

- Any assignee whose declared spelling resolves to the reader → `mine`.
- Otherwise, at least one declared spelling resolves to someone else → `theirs`.
- Otherwise → `unknown` (no assignee has a declared spelling, as today).

`theirs` therefore needs every *declared* assignee to resolve to someone else. An assignee with no declared spelling reads as no information, as it does now: it neither makes a ticket `mine` nor blocks `theirs`. The `host-login` arm of `ticketOwnership` (`sawTheirs` loop) is the model.

Update the doc comment on `accountTicketOwnership` so its `mine`/`theirs` wording states "any" and "every declared", in step with `ticketOwnership`.

Tests, in `packages/domain/test/ownership.test.ts`, one assertion per order:

- `[mruepp, jan]` with both spellings declared → `mine`.
- `[jan, mruepp]` → `mine`.
- `[mruepp, other]` with neither resolving to the reader → `theirs`.
- `[undeclared, mruepp]` with only `mruepp` declared (someone else) → `theirs`.

One assertion in `packages/domain/test/waiting-tickets.test.ts` pins that a ticket with the reader second appears in *Waiting on you* with «Mine» off.

### Open Questions

- [ ] Should an assignee with no declared spelling, listed next to a declared other person, keep the ticket `theirs`? This plan keeps today's reading (it does); the alternative is `unknown`, which hides fewer rows but changes more behaviour than the issue asks for.

## Slices

### Ownership across assignees

- `bug/a-jira-ticket-with-several-assignees` — check every assignee in `accountTicketOwnership`, update its doc comment, add the domain and *Waiting on you* assertions for both assignee orders

## Notes

- Source: https://github.com/plot-pm/plot/issues/2819. Found while reviewing #2811; filed separately so that PR stays scoped.
